import { expect, test } from "bun:test";
import { MCP_STARTING_POLL_MS, type McpWatchDeps, startMcpWorkspaceWatch } from "./mcp";

function harness(options: { starting: boolean; failRead?: boolean }) {
	let starting = options.starting;
	let listener: () => void = () => {};
	const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
	const reads: { resolve: () => void; reject: (error: Error) => void }[] = [];
	const results: unknown[] = [];
	const deps: McpWatchDeps = {
		read: () =>
			new Promise<void>((resolve, reject) => {
				reads.push({ resolve, reject });
			}),
		starting: () => starting,
		subscribe: (next) => {
			listener = next;
			return () => {
				listener = () => {};
			};
		},
		setTimer: (run, ms) => {
			const timer = { run, ms, cleared: false };
			timers.push(timer);
			return timers.length as unknown as ReturnType<typeof setTimeout>;
		},
		clearTimer: (handle) => {
			const timer = timers[(handle as unknown as number) - 1];
			if (timer) timer.cleared = true;
		},
		onRead: (error) => results.push(error),
	};
	return {
		deps,
		timers,
		reads,
		results,
		setStarting: (value: boolean) => {
			starting = value;
			listener();
		},
		settleRead: async (fail = false) => {
			const read = reads.at(-1);
			if (fail) read?.reject(new Error("offline"));
			else read?.resolve();
			await Promise.resolve();
			await Promise.resolve();
		},
		fire: () => {
			const timer = timers.at(-1);
			if (timer && !timer.cleared) timer.run();
		},
	};
}

test("the watch reads once and polls with backoff only while a server is starting", async () => {
	const h = harness({ starting: true });
	const stop = startMcpWorkspaceWatch(h.deps);
	expect(h.reads).toHaveLength(1);
	await h.settleRead();
	expect(h.results).toEqual([null]);
	expect(h.timers.map((timer) => timer.ms)).toEqual([MCP_STARTING_POLL_MS[0]]);
	h.fire();
	expect(h.reads).toHaveLength(2);
	await h.settleRead(true);
	expect(h.results[1]).toBeInstanceOf(Error);
	expect(h.timers.map((timer) => timer.ms)).toEqual(MCP_STARTING_POLL_MS.slice(0, 2));
	h.setStarting(false);
	h.fire();
	await h.settleRead();
	expect(h.timers).toHaveLength(2);
	stop();
});

test("the poll budget is bounded and resets once nothing is starting", async () => {
	const h = harness({ starting: true });
	const stop = startMcpWorkspaceWatch(h.deps);
	await h.settleRead();
	for (let attempt = 0; attempt < MCP_STARTING_POLL_MS.length + 2; attempt++) {
		h.fire();
		await h.settleRead();
	}
	expect(h.timers.map((timer) => timer.ms)).toEqual([...MCP_STARTING_POLL_MS]);
	h.setStarting(false);
	h.setStarting(true);
	expect(h.timers.at(-1)?.ms).toBe(MCP_STARTING_POLL_MS[0]);
	stop();
	expect(h.timers.at(-1)?.cleared).toBe(true);
});

test("a quiet workspace is read once, and a disposed watch reports nothing", async () => {
	const h = harness({ starting: false });
	const stop = startMcpWorkspaceWatch(h.deps);
	await h.settleRead();
	expect(h.timers).toHaveLength(0);
	h.setStarting(true);
	expect(h.timers).toHaveLength(1);
	stop();
	const late = harness({ starting: true });
	const stopLate = startMcpWorkspaceWatch(late.deps);
	stopLate();
	await late.settleRead();
	expect(late.results).toEqual([]);
	expect(late.timers).toHaveLength(0);
});
