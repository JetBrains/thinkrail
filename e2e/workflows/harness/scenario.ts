// The declarative surface — adding a workflow test = one defineScenario call in a spec file. This module
// only composes the other harness modules; the orchestration order and teardown guarantees live here.
// Verdict model (../SPEC.md § Verdict model): tier-1 checks + signals are BINDING; the judge is
// advisory; the watchdog and user simulator never touch the pass path.
import { test } from "@playwright/test";
import { type Check, type CheckResult, runChecks } from "./checks";
import { type AnsweredRound, attachDialog, type DialogConfig } from "./dialog";
import { captureEvents, type EventLog } from "./events";
import { type JudgeResult, judgeTranscript } from "./judge";
import { applyArtifactPreset, isRecordMode, recordFixture, useTranscriptFixture } from "./presets";
import { appendAggregatedRunRecord, appendRunRecord, type RunRecord } from "./runlog";
import { endSession, promptTurn, startSession, stopTurn } from "./session";
import { type Signal, type SignalHit, watchSignals } from "./signals";
import { nextUserMessage, openingMessage, type UserSimConfig } from "./userSim";
import { assessOnTrack, checkBudget, DEFAULT_BUDGET, type WatchdogConfig } from "./watchdog";
import { seedWorkspace, type WorkspaceSeed } from "./workspace";

export interface ScenarioDef {
	name: string;
	/** The workflow skill this scenario verifies (run-log / family-table attribution). */
	skill: string;
	workspace: WorkspaceSeed;
	preset?: {
		/** Workflow-owned mid-flow state (task-spec, working files) written before the session starts. */
		artifacts?: Record<string, string>;
		/** Continue a recorded session (fixture name under e2e/workflows/fixtures/). */
		transcript?: string;
	};
	/** Fixed entry — a natural prompt or a forced `/skill:` command. Omit when `user` composes the opening. */
	entry?: { prompt: string } | { skill: string; args?: string };
	/** The simulated human driving the conversation (../SPEC.md § userSim). */
	user?: UserSimConfig;
	dialog?: DialogConfig;
	/** Pass-signals: first hit aborts the run and satisfies the scenario. */
	stopWhen?: Signal[];
	/** Fail-signals: first hit aborts the run and fails it deterministically. */
	forbid?: Signal[];
	watchdog?: WatchdogConfig;
	/** Tier-1 binding checks, evaluated after the run. */
	expect: Check[];
	/** Tier-2 advisory rubric. */
	judge?: { rubric: string[] };
	/** Record this run as a transcript fixture of that name (record mode only). */
	record?: string;
	/** Run this scenario multiple times and aggregate the judge verdicts + pass rate in the run record. */
	repeat?: number;
	/** Internal: skip writing the runlog (used during repeated runs so the caller can aggregate). */
	skipRunlog?: boolean;
}

export interface ScenarioResult {
	pass: boolean;
	failed: string[];
	checks: CheckResult[];
	judge: JudgeResult | null;
	hit: SignalHit | null;
	watchdogReason: string | null;
	answered: AnsweredRound[];
	log: EventLog;
	cwd: string;
	model: string;
	durationMs: number;
	crashed?: string;
	runRecord?: RunRecord;
}

export function defineScenario(def: ScenarioDef): ScenarioDef {
	if (!def.entry && !def.user)
		throw new Error(`Scenario "${def.name}": needs an entry or a user simulator.`);
	return def;
}

function entryText(def: ScenarioDef): Promise<string> {
	if (def.entry && "prompt" in def.entry) return Promise.resolve(def.entry.prompt);
	if (def.entry)
		return Promise.resolve(
			`/skill:${def.entry.skill}${def.entry.args ? ` ${def.entry.args}` : ""}`,
		);
	// biome-ignore lint/style/noNonNullAssertion: defineScenario guarantees entry or user.
	return openingMessage(def.user!);
}

export async function runScenario(def: ScenarioDef): Promise<ScenarioResult> {
	const startedAt = Date.now();
	const cwd = seedWorkspace(def.workspace);
	if (def.preset?.artifacts) applyArtifactPreset(cwd, def.preset.artifacts);

	const budget = { ...DEFAULT_BUDGET, ...def.watchdog?.budget };
	// Everything from the fixture swap onward lives INSIDE the try: a throw at any point (a missing
	// fixture, a failing startSession) must still restore the process-wide session-manager factory and
	// tear down whatever was attached — otherwise a later scenario would silently reopen this fixture.
	let restoreFactory: (() => void) | undefined;
	let sessionId: string | null = null;
	let model = "unknown";
	let dialog: ReturnType<typeof attachDialog> | null = null;
	let watcher: ReturnType<typeof watchSignals> | null = null;
	let unsubscribeBudget: () => void = () => {};
	let watchdogReason: string | null = null;
	let judge: JudgeResult | null = null;
	let checks: CheckResult[] = [];
	// A throw before the verdict section — the run CRASHED (provider/auth/fixture failure, not a
	// deterministic check failure). Recorded explicitly so the run log never claims a false pass.
	let crashed: string | undefined;
	const failed: string[] = [];
	let resultObj: ScenarioResult | undefined;
	try {
		restoreFactory = def.preset?.transcript
			? useTranscriptFixture(def.preset.transcript, cwd)
			: undefined;
		const started = await startSession(cwd);
		sessionId = started.sessionId;
		model = started.model;
		const id = started.sessionId;
		const log = captureEvents(id);
		const persona = def.dialog?.persona ?? def.user?.brief;
		dialog = attachDialog(id, log, {
			...def.dialog,
			...(persona ? { persona } : {}),
		});
		const activeWatcher = watchSignals(log, def.stopWhen ?? [], def.forbid ?? []);
		watcher = activeWatcher;
		// Cost control: the moment any signal fires, abort the in-flight turn.
		void activeWatcher.hit.then(() => stopTurn(id));

		// Mid-turn budget tripwire: checked on every event, aborts a runaway turn without waiting for turn end.
		unsubscribeBudget = log.onGrow(() => {
			if (watchdogReason || activeWatcher.peek()) return;
			const reason = checkBudget(log, startedAt, budget);
			if (reason) {
				watchdogReason = reason;
				void stopTurn(id);
			}
		});

		let text = await entryText(def);
		let userTurns = 0;
		const maxUserTurns = def.user?.maxUserTurns ?? 2;
		// An abort error out of a turn is expected ONLY when a signal or the budget actually requested one
		// — an unrequested "aborted" (provider/network failure) must surface as the crash it is.
		const abortRequested = (): boolean => activeWatcher.peek() !== null || watchdogReason !== null;
		// The conversation loop: one prompt per iteration; continues only for a live user simulator.
		for (;;) {
			await promptTurn(id, text, abortRequested);
			if (activeWatcher.peek() || watchdogReason) break;
			if (def.watchdog?.intent) {
				const assessment = await assessOnTrack(log, def.watchdog.intent);
				if (!assessment.onTrack) {
					watchdogReason = `watchdog: ${assessment.reason}`;
					break;
				}
			}
			if (!def.user || userTurns >= maxUserTurns) break;
			const next = await nextUserMessage(log.renderTranscript(), def.user.brief);
			if (!next) break;
			userTurns += 1;
			text = next;
		}

		// ---- verdict (binding, deterministic) ----
		checks = runChecks(def.expect, { log, cwd });
		for (const check of checks) {
			if (!check.pass) {
				const prefix = check.tag ? `[${check.tag}] ` : "";
				failed.push(`${prefix}${check.name} — ${check.detail}`);
			}
		}
		const hit = activeWatcher.peek();
		if (hit?.kind === "forbid") {
			const prefix = hit.signal.tag ? `[${hit.signal.tag}] ` : "";
			failed.push(`${prefix}forbid signal fired: ${hit.signal.description}`);
		}
		if ((def.stopWhen?.length ?? 0) > 0 && hit?.kind !== "stop") {
			failed.push(
				`no stop signal fired${watchdogReason ? ` — ${watchdogReason}` : " (turn ended without it)"}`,
			);
		}

		// ---- judge (advisory) ----
		if (def.judge) judge = await judgeTranscript(log.renderTranscript(), def.judge.rubric);

		if (isRecordMode() && def.record) await recordFixture(def.record, cwd);

		resultObj = {
			pass: failed.length === 0,
			failed,
			checks,
			judge,
			hit,
			watchdogReason,
			answered: dialog.answered,
			log,
			cwd,
			model,
			durationMs: Date.now() - startedAt,
		};
		return resultObj;
	} catch (error) {
		crashed = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		unsubscribeBudget();
		watcher?.cancel();
		dialog?.detach();
		restoreFactory?.();
		if (sessionId) endSession(sessionId);
		
		const record = {
			at: new Date().toISOString(),
			model,
			scenario: def.name,
			skill: def.skill,
			// A crashed run can never record a deterministic pass — its checks never ran.
			deterministic: { pass: !crashed && failed.length === 0, failed, checks },
			judge,
			dialog: (dialog?.answered ?? []).map((round) => ({
				rung: round.rung,
				cancelled: round.result.cancelled,
				...(round.error ? { error: round.error } : {}),
			})),
			durationMs: Date.now() - startedAt,
			aborted: (watcher?.peek() ?? null) !== null || watchdogReason !== null,
			...(crashed ? { crashed } : {}),
			notes: watchdogReason ?? "",
		};

		if (resultObj) resultObj.runRecord = record;

		if (!def.skipRunlog) {
			appendRunRecord(record);
		} else {
			// Attach record to the error if we crashed, so workflowTest can collect it.
			if (crashed) {
				// We inject it into a global or error object, but throwing is required.
				// Since we can't easily return it, we will just attach it to the error.
				try {
					// @ts-ignore
					if (typeof error !== "undefined" && error instanceof Error) error.runRecord = record;
				} catch (e) {}
			}
		}
	}
}

/** Register a scenario as a Playwright test: run → warn on advisory failures → assert binding verdicts. */
export function workflowTest(def: ScenarioDef): void {
	test(def.name, { tag: "@agent" }, async () => {
		const repeats = def.repeat ?? 1;
		const results: ScenarioResult[] = [];
		const records: RunRecord[] = [];

		for (let i = 0; i < repeats; i++) {
			try {
				const result = await runScenario({ ...def, skipRunlog: repeats > 1 });
				results.push(result);
				if (result.runRecord) records.push(result.runRecord);
			} catch (err: any) {
				if (err.runRecord) records.push(err.runRecord);
				throw err;
			}
		}

		if (repeats > 1 && records.length > 0) {
			appendAggregatedRunRecord(records);
		}

		// Calculate aggregate pass and judge for assertions/warnings
		const passes = results.filter((r) => r.pass).length;
		const passRate = passes / repeats;
		const allFailed = new Set<string>();
		for (const r of results) {
			for (const f of r.failed) allFailed.add(f);
		}

		const validJudges = results.filter((r) => r.judge !== null).map((r) => r.judge!);
		if (validJudges.length > 0) {
			const statements = validJudges[0].items.map((i) => i.statement);
			for (const statement of statements) {
				let passed = 0;
				let total = 0;
				for (const j of validJudges) {
					const item = j.items.find((i) => i.statement === statement);
					if (item) {
						total++;
						if (item.verdict === "pass") passed++;
					}
				}
				const avg = total > 0 ? passed / total : 0;
				if (avg < 1) {
					console.warn(`[judge advisory] ${def.name}: FAIL "${statement}" — pass rate ${(avg * 100).toFixed(0)}%`);
				}
			}
		} else if (repeats === 1) {
			const advisoryFailures = results[0].judge?.items.filter((item) => item.verdict === "fail") ?? [];
			for (const item of advisoryFailures)
				console.warn(`[judge advisory] ${def.name}: FAIL "${item.statement}" — ${item.evidence}`);
		}

		// Throw if deterministic pass rate drops below 100% (or whatever threshold)
		// For now, any failure fails the test.
		if (passRate < 1) {
			throw new Error(
				`Scenario "${def.name}" failed deterministic checks in ${repeats - passes}/${repeats} runs:\n- ${Array.from(allFailed).join("\n- ")}`,
			);
		}
	});
}
