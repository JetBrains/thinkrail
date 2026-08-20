import { test } from "@playwright/test";
import { type Check, type CheckResult, runChecks } from "./checks";
import { type AnsweredRound, attachDialog, type DialogConfig } from "./dialog";
import { captureEvents, type EventLog } from "./events";
import { type JudgeResult, judgeTranscript } from "./judge";
import { applyArtifactPreset, isRecordMode, recordFixture, useTranscriptFixture } from "./presets";
import { appendRunRecord } from "./runlog";
import { endSession, promptTurn, startSession, stopTurn } from "./session";
import { type Signal, type SignalHit, watchSignals } from "./signals";
import { nextUserMessage, openingMessage, type UserSimConfig } from "./userSim";
import { assessOnTrack, checkBudget, DEFAULT_BUDGET, type WatchdogConfig } from "./watchdog";
import { seedWorkspace, type WorkspaceSeed } from "./workspace";

export interface ScenarioDef {
	name: string;
	skill: string;
	workspace: WorkspaceSeed;
	preset?: {
		artifacts?: Record<string, string>;
		transcript?: string;
	};
	entry?: { prompt: string } | { skill: string; args?: string };
	user?: UserSimConfig;
	dialog?: DialogConfig;
	stopWhen?: Signal[];
	forbid?: Signal[];
	watchdog?: WatchdogConfig;
	expect: Check[];
	judge?: { rubric: string[] };
	record?: string;
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
	let restoreFactory: (() => void) | undefined;
	let sessionId: string | null = null;
	let model = "unknown";
	let dialog: ReturnType<typeof attachDialog> | null = null;
	let watcher: ReturnType<typeof watchSignals> | null = null;
	let unsubscribeBudget: () => void = () => {};
	let watchdogReason: string | null = null;
	let judge: JudgeResult | null = null;
	let checks: CheckResult[] = [];
	let crashed: string | undefined;
	const failed: string[] = [];
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
		void activeWatcher.hit.then(() => stopTurn(id));

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
		const abortRequested = (): boolean => activeWatcher.peek() !== null || watchdogReason !== null;
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

		await dialog.settle();

		checks = runChecks(def.expect, { log, cwd });
		for (const check of checks) if (!check.pass) failed.push(`${check.name} — ${check.detail}`);
		const hit = activeWatcher.peek();
		if (hit?.kind === "forbid") failed.push(`forbid signal fired: ${hit.signal.description}`);
		if ((def.stopWhen?.length ?? 0) > 0 && hit?.kind !== "stop")
			failed.push(
				`no stop signal fired${watchdogReason ? ` — ${watchdogReason}` : " (turn ended without it)"}`,
			);

		if (def.judge) judge = await judgeTranscript(log.renderTranscript(), def.judge.rubric);

		if (isRecordMode() && def.record) await recordFixture(def.record, cwd);

		return {
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
	} catch (error) {
		crashed = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		unsubscribeBudget();
		watcher?.cancel();
		dialog?.detach();
		restoreFactory?.();
		if (sessionId) endSession(sessionId);
		appendRunRecord({
			at: new Date().toISOString(),
			model,
			scenario: def.name,
			skill: def.skill,
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
		});
	}
}

export function workflowTest(def: ScenarioDef): void {
	test(def.name, { tag: "@agent" }, async () => {
		const result = await runScenario(def);
		const advisoryFailures = result.judge?.items.filter((item) => item.verdict === "fail") ?? [];
		for (const item of advisoryFailures)
			console.warn(`[judge advisory] ${def.name}: FAIL "${item.statement}" — ${item.evidence}`);
		if (!result.pass)
			throw new Error(
				`Scenario "${def.name}" failed deterministic checks:\n- ${result.failed.join("\n- ")}\n\nTranscript:\n${result.log.renderTranscript()}`,
			);
	});
}
