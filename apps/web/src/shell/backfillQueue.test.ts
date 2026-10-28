import { describe, expect, test } from "bun:test";
import { createBackfillQueue } from "./backfillQueue";

function deferredRuns() {
	const started: string[] = [];
	const resolvers = new Map<string, () => void>();
	const run = (key: string) =>
		new Promise<void>((resolve) => {
			started.push(key);
			resolvers.set(key, resolve);
		});
	const finish = async (key: string) => {
		resolvers.get(key)?.();
		resolvers.delete(key);
		await Promise.resolve();
		await Promise.resolve();
	};
	return { started, run, finish, outstanding: () => resolvers.size };
}

describe("backfill queue", () => {
	test("the concurrency budget holds across reschedules, and a key is never requested twice at once", async () => {
		const runs = deferredRuns();
		const done = new Set<string>();
		const queue = createBackfillQueue({
			concurrency: 2,
			run: (key) => runs.run(key).then(() => done.add(key)),
			isWanted: (key) => !done.has(key),
		});
		queue.schedule(["a", "b", "c"]);
		queue.schedule(["a", "b", "c"]);
		queue.clearPending();
		queue.schedule(["c", "b", "a", "d"]);
		expect(runs.started).toEqual(["a", "b"]);
		expect(runs.outstanding()).toBe(2);
		await runs.finish("a");
		expect(runs.started).toEqual(["a", "b", "c"]);
		await runs.finish("b");
		await runs.finish("c");
		expect(runs.started).toEqual(["a", "b", "c", "d"]);
	});

	test("a reschedule replaces the pending order, and clearPending drops what has not started", async () => {
		const runs = deferredRuns();
		const queue = createBackfillQueue({ concurrency: 1, run: runs.run });
		queue.schedule(["a", "b", "c"]);
		queue.schedule(["c", "b"]);
		await runs.finish("a");
		expect(runs.started).toEqual(["a", "c"]);
		queue.clearPending();
		await runs.finish("c");
		expect(runs.started).toEqual(["a", "c"]);
	});

	test("keys that are no longer wanted are skipped when scheduled and when dequeued", async () => {
		const runs = deferredRuns();
		const done = new Set(["x"]);
		const queue = createBackfillQueue({
			concurrency: 1,
			run: runs.run,
			isWanted: (key) => !done.has(key),
		});
		queue.schedule(["x", "a", "b"]);
		expect(runs.started).toEqual(["a"]);
		done.add("b");
		await runs.finish("a");
		expect(runs.started).toEqual(["a"]);
	});

	test("a key rescheduled while in flight runs once more after it lands, if it is still wanted", async () => {
		const runs = deferredRuns();
		let wanted = true;
		const queue = createBackfillQueue({ concurrency: 2, run: runs.run, isWanted: () => wanted });
		queue.schedule(["a"]);
		queue.schedule(["a"]);
		queue.schedule(["a"]);
		expect(runs.started).toEqual(["a"]);
		await runs.finish("a");
		expect(runs.started).toEqual(["a", "a"]);
		wanted = false;
		queue.schedule(["a"]);
		await runs.finish("a");
		expect(runs.started).toEqual(["a", "a"]);
	});

	test("a failed run frees its lane", async () => {
		const started: string[] = [];
		const queue = createBackfillQueue({
			concurrency: 1,
			run: async (key) => {
				started.push(key);
				throw new Error(`boom ${key}`);
			},
		});
		queue.schedule(["a", "b"]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(started).toEqual(["a", "b"]);
	});
});
