import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AgentHandle, type AgentUsage, defineExtension } from "@thinkrail/ext";
import type { ModelRef, RunChild } from "./agent";
import {
	isRecord,
	type Limits,
	RUN_PREFIX,
	RUNS_KEY,
	runKey,
	summarize,
	type Usage,
	type WorkflowRun,
} from "./model";
import {
	compactRun,
	journalDirOf,
	mergeRuns,
	openReplay,
	pruneJournals,
	readRuns,
	STORE_KEY,
} from "./persist";
import { type StartRun, ultracodePi } from "./pi";
import { DEFAULT_MAX_AGENTS } from "./rails";
import { createWorkflowRun } from "./run";
import { liveText, summaryText } from "./summary";

const FLUSH_MS = 250;
const DEFAULT_CONCURRENCY = 6;

interface Live {
	run: WorkflowRun;
	controller: AbortController;
	handles: Set<AgentHandle>;
	onUpdate?: () => void;
	done?: Promise<WorkflowRun>;
}

const usageOf = (usage: AgentUsage): Usage => ({
	input: usage.input,
	output: usage.output,
	cacheRead: usage.cacheRead,
	cacheWrite: usage.cacheWrite,
	cost: usage.cost,
	turns: usage.turns,
});

const modelsOf = (ctx: ExtensionContext) => (): ModelRef[] =>
	ctx.modelRegistry.getAll().map((model) => ({
		provider: model.provider,
		id: model.id,
		name: model.name,
	}));

export default defineExtension(async (tr) => {
	let stored = await tr.store.get<unknown>(STORE_KEY);
	let finished = readRuns(stored);
	let saving = 0;
	const live = new Map<string, Live>();
	const watching = new Set<string>();
	const dirty = new Set<string>();
	const generation = new AbortController();

	const findRun = (runId: string) =>
		live.get(runId)?.run ?? finished.find((run) => run.runId === runId);

	const publishList = () => {
		if (generation.signal.aborted) return;
		tr.publish(RUNS_KEY, [
			...[...live.values()].map((entry) => summarize(entry.run)).reverse(),
			...finished.map(summarize),
		]);
	};

	const publishRun = (runId: string) => {
		if (generation.signal.aborted) return;
		const run = findRun(runId);
		if (run && watching.has(runId)) tr.publish(runKey(runId), run);
		else tr.unpublish(runKey(runId));
	};

	const adopt = (value: unknown) => {
		stored = value;
		finished = mergeRuns(finished, readRuns(value));
	};

	const syncStored = async () => {
		if (saving > 0) return;
		const value = await tr.store.get<unknown>(STORE_KEY);
		if (saving > 0 || value === stored) return;
		adopt(value);
		publishList();
	};

	const flush = () => {
		void syncStored().catch((error: unknown) => tr.log("reading runs failed", error));
		if (dirty.size === 0) return;
		for (const runId of dirty) {
			publishRun(runId);
			live.get(runId)?.onUpdate?.();
		}
		dirty.clear();
		publishList();
	};

	const save = async (drop?: string) => {
		saving += 1;
		try {
			adopt(await tr.store.get<unknown>(STORE_KEY));
			if (drop !== undefined) finished = finished.filter((run) => run.runId !== drop);
			await tr.store.set(STORE_KEY, finished);
			stored = await tr.store.get<unknown>(STORE_KEY);
		} finally {
			saving -= 1;
		}
		publishList();
		if (!generation.signal.aborted)
			pruneJournals(new Set([...finished.map((run) => run.runId), ...live.keys()]));
	};

	const childRunner =
		(handles: Set<AgentHandle>, maxConcurrent: number, ctx: ExtensionContext): RunChild =>
		async ({ task, spec, signal, onPatch }) => {
			const handle = await tr.agents.spawn(
				{ task, ...spec },
				{ parent: ctx, signal, maxConcurrent },
			);
			handles.add(handle);
			onPatch({ childId: handle.id, ...(handle.status === "running" ? { state: "running" } : {}) });
			const off = handle.onEvent((event) => {
				if (event.type === "started") onPatch({ state: "running" });
				if (event.type !== "progress") return;
				const { progress } = event;
				onPatch({
					...(progress.status === "running" ? { state: "running" } : {}),
					...(progress.model !== undefined ? { model: progress.model } : {}),
					...(progress.activity !== undefined ? { activity: progress.activity } : {}),
					usage: usageOf(progress.usage),
				});
			});
			try {
				return await handle.result;
			} finally {
				off();
				handles.delete(handle);
			}
		};

	const cancel = async (entry: Live) => {
		entry.controller.abort();
		await Promise.all([...entry.handles].map((handle) => handle.cancel()));
	};

	const start: StartRun = async (request) => {
		if (generation.signal.aborted) throw new Error("The ultracode extension is reloading.");
		const resume = request.resumeFromRunId
			? openReplay(request.resumeFromRunId, request.resumeRetryFailed)
			: undefined;
		const runId = `uc_${randomUUID().replaceAll("-", "").slice(0, 11)}`;
		const limits: Limits = {
			concurrency: request.concurrency ?? DEFAULT_CONCURRENCY,
			maxAgents: request.maxAgents ?? DEFAULT_MAX_AGENTS,
			...(request.maxCost !== undefined ? { maxCost: request.maxCost } : {}),
			...(request.agentTimeoutMs !== undefined ? { agentTimeoutMs: request.agentTimeoutMs } : {}),
		};
		const controller = new AbortController();
		const handles = new Set<AgentHandle>();
		const created = createWorkflowRun({
			runId,
			script: request.script,
			args: request.args,
			parentSessionId: request.ctx.sessionManager.getSessionId(),
			limits,
			context: {
				cwd: request.ctx.cwd,
				models: modelsOf(request.ctx),
				runChild: childRunner(handles, limits.concurrency, request.ctx),
			},
			signal: controller.signal,
			journalDir: journalDirOf(runId),
			...(resume ? { replay: resume.replay, resumedFrom: request.resumeFromRunId } : {}),
			onChange: () => dirty.add(runId),
		});
		const entry: Live = {
			run: created.run,
			controller,
			handles,
			onUpdate: () => request.onUpdate(liveText(created.run), summarize(created.run)),
		};
		const onAbort = () => void cancel(entry);
		request.signal?.addEventListener("abort", onAbort, { once: true });
		if (request.signal?.aborted) onAbort();
		live.set(runId, entry);
		if (resume) created.run.logs.push(resume.note);
		dirty.add(runId);
		tr.log(`run ${runId} (${created.run.name}) started`);

		entry.done = created.execute();
		const run = await entry.done;
		request.signal?.removeEventListener("abort", onAbort);
		live.delete(runId);
		tr.log(`run ${runId} ${run.status}`);
		finished = mergeRuns([compactRun(run)], finished);
		dirty.delete(runId);
		publishRun(runId);
		publishList();
		await save().catch((error: unknown) => tr.log("saving runs failed", error));
		return { text: summaryText(run, journalDirOf(runId)), details: summarize(run) };
	};

	tr.onWatch((key, watched) => {
		if (!key.startsWith(RUN_PREFIX)) return;
		const runId = key.slice(RUN_PREFIX.length);
		if (watched) watching.add(runId);
		else watching.delete(runId);
		publishRun(runId);
	});

	tr.every(FLUSH_MS, flush);

	tr.action("cancel", async (payload) => {
		const runId = isRecord(payload) && typeof payload.runId === "string" ? payload.runId : "";
		const entry = live.get(runId);
		if (!entry) return { cancelled: false };
		await cancel(entry);
		return { cancelled: true };
	});

	tr.action("forget", async (payload) => {
		const runId = isRecord(payload) && typeof payload.runId === "string" ? payload.runId : "";
		if (live.has(runId)) return { forgotten: false };
		const known = finished.some((run) => run.runId === runId);
		await save(runId);
		publishRun(runId);
		return { forgotten: known };
	});

	tr.pi(ultracodePi(start));
	publishList();

	return async () => {
		generation.abort();
		const running = [...live.values()];
		await Promise.all(running.map(cancel));
		await Promise.allSettled(running.map((entry) => entry.done));
	};
});
