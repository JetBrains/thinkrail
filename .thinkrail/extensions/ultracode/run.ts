import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs";
import * as path from "node:path";
import { type AgentContext, runAgent } from "./agent";
import { agentKey, openJournal, type ReplayStore, safeStringify } from "./journal";
import { extractMeta, runUltracodeScript } from "./loader";
import {
	type AgentRow,
	clip,
	clipTail,
	countAgents,
	emptyUsage,
	formatCost,
	formatDuration,
	formatTokens,
	type Limits,
	type RunStatus,
	runUsage,
	tokensOf,
	type WorkflowRun,
} from "./model";
import {
	type PipelineStage,
	parallelArgError,
	pipelineArgError,
	runBounded,
	runPipeline,
} from "./parallel";
import { createRails, RailError } from "./rails";
import type { AgentOptions, UltracodeRuntimeApi } from "./types";
import { assertSchemaSupported } from "./validate";

const IMPLICIT_PHASE_TITLE = "Agents";
const PROMPT_CHARS = 4_000;
const OUTPUT_CHARS = 2_000;
const LOG_LINES = 200;

interface BatchScope {
	readonly cancel: AbortController;
	readonly children: Set<AbortController>;
}

const batchScopes = new AsyncLocalStorage<BatchScope[]>();

const createSemaphore = (limit: number) => {
	const waiting: Array<() => void> = [];
	let active = 0;
	const handOff = () => {
		const next = waiting.shift();
		if (next) next();
		else active -= 1;
	};
	return async () => {
		if (active < limit) active += 1;
		else await new Promise<void>((resolve) => waiting.push(resolve));
		let released = false;
		return () => {
			if (released) return;
			released = true;
			handOff();
		};
	};
};

const asText = (value: unknown) => (typeof value === "string" ? value : safeStringify(value, 0));

export interface RunOptions {
	runId: string;
	script: string;
	args: unknown;
	parentSessionId: string;
	limits: Limits;
	context: AgentContext;
	signal: AbortSignal;
	journalDir: string;
	replay?: ReplayStore;
	resumedFrom?: string;
	onChange: () => void;
}

export const createWorkflowRun = (options: RunOptions) => {
	const { signal, context, replay, onChange } = options;
	const meta = extractMeta(options.script);
	const run: WorkflowRun = {
		runId: options.runId,
		name: meta.name,
		description: meta.description,
		status: "running",
		parentSessionId: options.parentSessionId,
		startedAt: Date.now(),
		phases: [],
		agents: [],
		logs: [],
		limits: options.limits,
		...(options.args !== undefined ? { args: options.args } : {}),
		...(options.resumedFrom !== undefined ? { resumedFrom: options.resumedFrom } : {}),
	};
	const details = new Map((meta.phases ?? []).map((phase) => [phase.title, phase.detail]));
	const acquire = createSemaphore(options.limits.concurrency);
	const log = (line: string) => {
		run.logs.push(line);
		if (run.logs.length > LOG_LINES) run.logs.splice(0, run.logs.length - LOG_LINES);
		onChange();
	};
	const rails = createRails({
		runId: options.runId,
		emit: log,
		maxAgents: options.limits.maxAgents,
		...(options.limits.maxCost !== undefined ? { maxCost: options.limits.maxCost } : {}),
		...(options.limits.agentTimeoutMs !== undefined
			? { agentTimeoutMs: options.limits.agentTimeoutMs }
			: {}),
	});
	const journal = openJournal(path.join(options.journalDir, "journal.jsonl"), (message) =>
		log(`⚠ journal write failed: ${message} (a resume will not see this run)`),
	);
	const stop = new AbortController();
	const stopRun = () => stop.abort();
	const inflight = new Set<Promise<unknown>>();
	let ended = false;
	let phaseIndex = -1;
	let agentSeq = 0;

	const addPhase = (title: string) => {
		const index = run.phases.length;
		const detail = details.get(title);
		run.phases.push({ index, title, ...(detail !== undefined ? { detail } : {}) });
		log(`▸ ${title}`);
		return index;
	};

	const phase = (title: string) => {
		phaseIndex = addPhase(String(title));
	};

	const resolvePhase = (title: string) =>
		run.phases.find((entry) => entry.title === title)?.index ?? addPhase(title);

	const currentPhaseIndex = () => {
		if (phaseIndex < 0) phaseIndex = addPhase(IMPLICIT_PHASE_TITLE);
		return phaseIndex;
	};

	const settle = (entry: AgentRow) => {
		entry.endedAt = Date.now();
		delete entry.activity;
		onChange();
	};

	const runOne = async (prompt: string, agentOptions: AgentOptions) => {
		if (ended) return null;
		rails.assertRunnable();
		if ("cwd" in agentOptions)
			rails.breach(
				"agent() option cwd is not supported: children share the chat's working directory",
				false,
			);
		if (agentOptions.schema) {
			try {
				assertSchemaSupported(agentOptions.schema);
			} catch (error) {
				const message = (error as Error).message;
				log(`✗ ${agentOptions.label ?? "agent"}  ${clip(message, 400)}`);
				rails.breach(message, false);
			}
		}
		const scopes = batchScopes.getStore() ?? [];
		if (scopes.some((scope) => scope.cancel.signal.aborted)) return null;
		rails.assertAgentCap(agentSeq);

		const key = agentKey(prompt, agentOptions);
		const hit = replay?.take(key);
		const index = agentSeq++;
		const label = agentOptions.label ?? `agent-${index}`;
		const entry: AgentRow = {
			index,
			label,
			phaseIndex: agentOptions.phase ? resolvePhase(agentOptions.phase) : currentPhaseIndex(),
			state: "queued",
			attempt: 1,
			queuedAt: Date.now(),
			prompt: clip(prompt, PROMPT_CHARS),
			usage: emptyUsage(),
		};
		run.agents.push(entry);
		onChange();

		if (hit) {
			entry.state = hit.ok ? "done" : "failed";
			entry.replayed = true;
			entry.attempt = hit.attempts;
			entry.usage = hit.usage;
			entry.startedAt = entry.queuedAt;
			entry.endedAt = entry.queuedAt;
			if (hit.ok) {
				entry.output = clipTail(asText(hit.value), OUTPUT_CHARS);
				if (agentOptions.schema) entry.result = hit.value;
			} else entry.error = hit.error ?? "replayed failure";
			journal.appendResult({ ...hit, agentIndex: index, label, value: hit.ok ? hit.value : null });
			log(`⟲ ${label}  replayed${hit.ok ? "" : " (failed then)"}`);
			onChange();
			return hit.ok ? hit.value : null;
		}

		const child = new AbortController();
		const cancelChild = () => child.abort();
		if (stop.signal.aborted) child.abort();
		else stop.signal.addEventListener("abort", cancelChild, { once: true });
		for (const scope of scopes) scope.children.add(child);

		let release: (() => void) | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;
		try {
			release = await acquire();
			if (child.signal.aborted) throw new Error("cancelled before start");
			rails.assertCostBudget(runUsage(run).cost);
			if (rails.agentTimeoutMs !== undefined) {
				const ms = rails.agentTimeoutMs;
				timer = setTimeout(() => {
					timedOut = true;
					child.abort();
				}, ms);
			}
			journal.appendStarted({ key, agentIndex: index, label });
			const result = await runAgent({
				prompt,
				options: agentOptions,
				context,
				signal: child.signal,
				onProgress: (progress) => {
					if (progress.state === "running" && entry.state === "queued") {
						entry.state = "running";
						entry.startedAt ??= Date.now();
					}
					entry.attempt = progress.attempt;
					if (progress.childId) entry.childId = progress.childId;
					if (progress.model) entry.model = progress.model;
					if (progress.usage) entry.usage = progress.usage;
					if (progress.activity) entry.activity = progress.activity;
					onChange();
				},
			});
			entry.state = "done";
			entry.usage = result.usage;
			if (result.model) entry.model = result.model;
			entry.output = clipTail(result.text, OUTPUT_CHARS);
			if (agentOptions.schema) entry.result = result.value;
			settle(entry);
			const durationMs = (entry.endedAt ?? 0) - (entry.startedAt ?? entry.queuedAt);
			journal.appendResult({
				key,
				agentIndex: index,
				label,
				ok: true,
				value: result.value,
				attempts: result.attempts,
				usage: result.usage,
				durationMs,
			});
			log(
				`✓ ${label}  ${formatTokens(tokensOf(result.usage))} tok  ${formatCost(result.usage.cost)}  ${formatDuration(durationMs)}`,
			);
			return result.value;
		} catch (error) {
			const cancelled = child.signal.aborted && !timedOut;
			entry.state = cancelled ? "aborted" : "failed";
			entry.error = timedOut
				? `agent timed out after ${rails.agentTimeoutMs}ms; a plain resume replays this as null, resumeRetryFailed runs it again`
				: (error as Error).message;
			settle(entry);
			if (error instanceof RailError) {
				log(`✗ ${label}  ${clip(entry.error, 160)}`);
				throw error;
			}
			if (!cancelled)
				journal.appendResult({
					key,
					agentIndex: index,
					label,
					ok: false,
					value: null,
					error: entry.error,
					attempts: entry.attempt,
					usage: entry.usage,
					durationMs: (entry.endedAt ?? 0) - (entry.startedAt ?? entry.queuedAt),
				});
			log(`✗ ${label}  ${clip(entry.error, 120)}`);
			return null;
		} finally {
			if (timer) clearTimeout(timer);
			release?.();
			stop.signal.removeEventListener("abort", cancelChild);
			for (const scope of scopes) scope.children.delete(child);
		}
	};

	const agent = (prompt: string, agentOptions: AgentOptions = {}) => {
		const pending = runOne(prompt, agentOptions);
		inflight.add(pending);
		const forget = () => inflight.delete(pending);
		pending.then(forget, forget);
		return pending;
	};

	const parallel = async <T>(tasks: Array<() => Promise<T>>, opts?: { failFast?: boolean }) => {
		const badArgs = parallelArgError(tasks);
		if (badArgs) rails.breach(badArgs, false);
		rails.assertBatchSize("parallel", tasks.length);
		const raisedBefore = rails.mark();
		const scope: BatchScope = { cancel: new AbortController(), children: new Set() };
		const scopes = [...(batchScopes.getStore() ?? []), scope];
		const results = await batchScopes.run(scopes, () =>
			runBounded(tasks, {
				failFast: opts?.failFast ?? false,
				onFailFast: () => {
					scope.cancel.abort();
					for (const child of scope.children) child.abort();
				},
			}),
		);
		return rails.rethrowBreach(results, raisedBefore);
	};

	const pipeline = async <T>(items: readonly T[], ...stages: Array<PipelineStage<T>>) => {
		const badArgs = pipelineArgError(items, stages);
		if (badArgs) rails.breach(badArgs, false);
		rails.assertBatchSize("pipeline", items.length);
		const raisedBefore = rails.mark();
		const scope: BatchScope = { cancel: new AbortController(), children: new Set() };
		const scopes = [...(batchScopes.getStore() ?? []), scope];
		const results = await batchScopes.run(scopes, () =>
			runPipeline(items, stages, {
				shouldStop: () =>
					stop.signal.aborted ||
					rails.raisedSince(raisedBefore) ||
					scopes.some((each) => each.cancel.signal.aborted),
			}),
		);
		return rails.rethrowBreach(results, raisedBefore);
	};

	const api: UltracodeRuntimeApi = {
		agent,
		parallel,
		pipeline,
		phase,
		log: (message) => log(`• ${String(message)}`),
		args: options.args,
	};

	const finalize = (status: RunStatus, result?: unknown, error?: string) => {
		const counts = countAgents(run.agents);
		const allFailed = status === "completed" && counts.total > 0 && counts.done === 0;
		run.status = allFailed ? "failed" : status;
		run.endedAt = Date.now();
		if (result !== undefined) run.result = result;
		if (error) run.error = error;
		else if (allFailed) run.error = `all ${counts.total} agents failed`;
		onChange();
		return run;
	};

	const drain = async () => {
		ended = true;
		if (inflight.size > 0)
			log(`• the script ended with ${inflight.size} agent(s) in flight; cancelling them`);
		stop.abort();
		await Promise.allSettled([...inflight]);
		signal.removeEventListener("abort", stopRun);
	};

	const execute = async () => {
		if (signal.aborted) stop.abort();
		else signal.addEventListener("abort", stopRun, { once: true });
		try {
			fs.mkdirSync(options.journalDir, { recursive: true });
			fs.writeFileSync(path.join(options.journalDir, "script.js"), options.script, "utf8");
		} catch (error) {
			log(`⚠ could not save the script: ${(error as Error).message}`);
		}
		try {
			const result = await runUltracodeScript(options.script, api);
			await drain();
			return finalize(signal.aborted ? "aborted" : "completed", result);
		} catch (error) {
			await drain();
			return finalize(signal.aborted ? "aborted" : "failed", undefined, (error as Error).message);
		}
	};

	return { run, execute };
};
