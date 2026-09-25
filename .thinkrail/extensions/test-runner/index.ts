import { resolve } from "node:path";
import { defineExtension } from "@thinkrail/ext";
import { commandText, parseFilter, readRunner, runnerInfo } from "./detect";
import {
	CHANNEL_PREFIX,
	channelKey,
	clip,
	isRecord,
	isRunResult,
	type RunBy,
	type RunnerInfo,
	type RunReply,
	type RunResult,
	type TestsState,
} from "./model";
import { type AgentRun, type RunForAgent, testRunnerPi } from "./pi";
import { errorResult, runTests } from "./process";

const STORE_KEY = "results";
const STORE_WORKSPACES = 10;
const FLUSH_MS = 250;
const LINE_CHARS = 200;

interface Active {
	command: string;
	filter?: string;
	by: RunBy;
	startedAt: number;
	lastLine: string;
	abort: AbortController;
	done: Promise<RunResult>;
}

type Start =
	| { kind: "started"; entry: Active }
	| { kind: "busy"; entry: Active }
	| { kind: "error"; message: string };

const readResults = (value: unknown) => {
	const results = new Map<string, RunResult>();
	if (!isRecord(value)) return results;
	for (const [workspaceId, result] of Object.entries(value))
		if (isRunResult(result)) results.set(workspaceId, result);
	return results;
};

const filterOf = (payload: unknown) =>
	isRecord(payload) && typeof payload.filter === "string" ? payload.filter : undefined;

const untilAborted = <T>(promise: Promise<T>, signal: AbortSignal | undefined) =>
	signal
		? new Promise<T>((done, fail) => {
				const onAbort = () => fail(new Error("run_tests was aborted"));
				if (signal.aborted) onAbort();
				signal.addEventListener("abort", onAbort, { once: true });
				promise.then(done, fail).finally(() => signal.removeEventListener("abort", onAbort));
			})
		: promise;

export default defineExtension(async (tr) => {
	const results = readResults(await tr.store.get<unknown>(STORE_KEY));
	const active = new Map<string, Active>();
	const runners = new Map<string, RunnerInfo>();
	const watching = new Set<string>();
	const dirty = new Set<string>();
	const generation = new AbortController();

	const detect = (workspaceId: string) => {
		const path = tr.workspaces.get(workspaceId)?.path;
		const info: RunnerInfo = path
			? runnerInfo(readRunner(path))
			: { state: "error", message: "This workspace is not open." };
		runners.set(workspaceId, info);
		return info;
	};

	const publish = (workspaceId: string) => {
		dirty.delete(workspaceId);
		const entry = active.get(workspaceId);
		if (generation.signal.aborted) return;
		if (!watching.has(workspaceId) && !entry) {
			tr.unpublish(channelKey(workspaceId));
			return;
		}
		const last = results.get(workspaceId);
		const state: TestsState = {
			runner: runners.get(workspaceId) ?? detect(workspaceId),
			...(entry
				? {
						running: {
							command: entry.command,
							...(entry.filter ? { filter: entry.filter } : {}),
							by: entry.by,
							startedAt: entry.startedAt,
							lastLine: entry.lastLine,
						},
					}
				: {}),
			...(last ? { last } : {}),
		};
		tr.publish(channelKey(workspaceId), state);
	};

	const save = async () => {
		const newest = [...results.entries()]
			.sort(([, a], [, b]) => b.startedAt - a.startedAt)
			.slice(0, STORE_WORKSPACES);
		for (const [workspaceId] of results)
			if (!newest.some(([kept]) => kept === workspaceId)) results.delete(workspaceId);
		await tr.store.set(STORE_KEY, Object.fromEntries(newest));
	};

	const start = (workspaceId: string, filter: string | undefined, by: RunBy): Start => {
		const running = active.get(workspaceId);
		if (running) return { kind: "busy", entry: running };
		const path = tr.workspaces.get(workspaceId)?.path;
		if (!path) return { kind: "error", message: "This workspace is not open." };
		const parsed = parseFilter(filter);
		if (!parsed.ok) return { kind: "error", message: parsed.message };
		const detected = readRunner(path);
		runners.set(workspaceId, runnerInfo(detected));
		if (!detected.ok) {
			publish(workspaceId);
			return { kind: "error", message: detected.message };
		}
		const abort = new AbortController();
		const onGeneration = () => abort.abort();
		generation.signal.addEventListener("abort", onGeneration, { once: true });
		const command = commandText(detected.runner, parsed.parts);
		const startedAt = Date.now();
		const entry: Active = {
			command,
			...(parsed.parts.length > 0 ? { filter: parsed.parts.join(" ") } : {}),
			by,
			startedAt,
			lastLine: "",
			abort,
			done: runTests({
				path,
				runner: detected.runner,
				filters: parsed.parts,
				command,
				by,
				signal: abort.signal,
				onLine: (line) => {
					entry.lastLine = clip(line, LINE_CHARS);
					dirty.add(workspaceId);
				},
			})
				.catch((error: unknown) =>
					errorResult({ filters: parsed.parts, command, by }, startedAt, error),
				)
				.then(async (result) => {
					generation.signal.removeEventListener("abort", onGeneration);
					if (active.get(workspaceId) === entry) active.delete(workspaceId);
					if (generation.signal.aborted) return result;
					results.set(workspaceId, result);
					tr.log(`${command} in ${path}: ${result.outcome}`);
					publish(workspaceId);
					await save().catch((error: unknown) => tr.log("saving results failed", error));
					return result;
				}),
		};
		active.set(workspaceId, entry);
		publish(workspaceId);
		return { kind: "started", entry };
	};

	const workspaceFor = (sessionId: string, cwd: string) =>
		tr.sessions.list().find((session) => session.sessionId === sessionId)?.workspaceId ??
		tr.workspaces.list().find((workspace) => resolve(workspace.path) === resolve(cwd))?.workspaceId;

	const runForAgent: RunForAgent = async (request, onStart): Promise<AgentRun> => {
		const workspaceId = workspaceFor(request.sessionId, request.cwd);
		if (!workspaceId) return { ok: false, message: "This chat has no open workspace to test." };
		const started = start(workspaceId, request.filter, "agent");
		if (started.kind === "error") return { ok: false, message: started.message };
		const { entry } = started;
		onStart(entry.command, entry.startedAt);
		if (started.kind === "busy") {
			const result = await untilAborted(entry.done, request.signal);
			return { ok: true, result, joined: true };
		}
		const cancel = () => entry.abort.abort();
		request.signal?.addEventListener("abort", cancel, { once: true });
		try {
			return { ok: true, result: await entry.done, joined: false };
		} finally {
			request.signal?.removeEventListener("abort", cancel);
		}
	};

	tr.onWatch((key, watched) => {
		if (!key.startsWith(CHANNEL_PREFIX)) return;
		const workspaceId = key.slice(CHANNEL_PREFIX.length);
		if (watched) {
			watching.add(workspaceId);
			detect(workspaceId);
			publish(workspaceId);
			return;
		}
		watching.delete(workspaceId);
		publish(workspaceId);
	});

	tr.every(FLUSH_MS, () => {
		for (const workspaceId of dirty) publish(workspaceId);
	});

	tr.action("run", (payload, ctx): RunReply => {
		if (!ctx.workspaceId) return { started: false, reason: "No workspace is open." };
		const started = start(ctx.workspaceId, filterOf(payload), "panel");
		if (started.kind === "busy") return { started: false, reason: "Tests are already running." };
		if (started.kind === "error") return { started: false, reason: started.message };
		return { started: true };
	});

	tr.action("cancel", (_payload, ctx) => {
		const entry = ctx.workspaceId ? active.get(ctx.workspaceId) : undefined;
		entry?.abort.abort();
		return { cancelled: Boolean(entry) };
	});

	tr.pi(testRunnerPi(runForAgent));

	return async () => {
		generation.abort();
		await Promise.allSettled([...active.values()].map((entry) => entry.done));
		active.clear();
	};
});
