import { expect, test } from "bun:test";
import {
	DETAIL_POLL_MS,
	type DetailPollScheduler,
	detailRetryDelay,
	startDetailPolling,
} from "./detailPolling";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function controlledScheduler() {
	const tasks: { callback: () => void; delayMs: number }[] = [];
	const scheduler: DetailPollScheduler = {
		set: (callback, delayMs) => {
			const task = { callback, delayMs };
			tasks.push(task);
			return task;
		},
		clear: (timer) => {
			const index = tasks.indexOf(timer as (typeof tasks)[number]);
			if (index >= 0) tasks.splice(index, 1);
		},
	};
	return {
		scheduler,
		tasks,
		runNext: () => tasks.shift()?.callback(),
	};
}

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
}

test("polling waits for each live response before scheduling the next read", async () => {
	const first = deferred<{ status: "running" | "completed"; revision: number }>();
	const second = deferred<{ status: "running" | "completed"; revision: number }>();
	const reads = [first, second];
	const results: number[] = [];
	const { scheduler, tasks, runNext } = controlledScheduler();
	let readCount = 0;

	const stop = startDetailPolling({
		read: () => {
			const read = reads[readCount++];
			if (!read) throw new Error("Unexpected read");
			return read.promise;
		},
		isLive: (result) => result.status === "running",
		isPermanentError: () => false,
		onResult: (result) => results.push(result.revision),
		onError: () => {},
		scheduler,
	});

	expect(readCount).toBe(1);
	expect(tasks).toHaveLength(0);
	first.resolve({ status: "running", revision: 1 });
	await flushPromises();
	expect(results).toEqual([1]);
	expect(tasks.map((task) => task.delayMs)).toEqual([DETAIL_POLL_MS]);

	runNext();
	expect(readCount).toBe(2);
	expect(tasks).toHaveLength(0);
	second.resolve({ status: "completed", revision: 2 });
	await flushPromises();
	expect(results).toEqual([1, 2]);
	expect(tasks).toHaveLength(0);
	stop.dispose();
});

test("transient failures back off while a permanent miss stops polling", async () => {
	const transient = new Error("offline");
	const permanent = new Error("missing");
	const errors: unknown[] = [];
	const { scheduler, tasks, runNext } = controlledScheduler();
	let readCount = 0;

	startDetailPolling({
		read: async () => {
			readCount++;
			throw readCount === 1 ? transient : permanent;
		},
		isLive: () => true,
		isPermanentError: (error) => error === permanent,
		onResult: () => {},
		onError: (error) => errors.push(error),
		scheduler,
	});

	await flushPromises();
	expect(errors).toEqual([transient]);
	expect(tasks.map((task) => task.delayMs)).toEqual([500]);
	runNext();
	await flushPromises();
	expect(errors).toEqual([transient, permanent]);
	expect(tasks).toHaveLength(0);
});

test("transcript retry backoff is capped while the dialog remains open", () => {
	expect(detailRetryDelay(1)).toBe(500);
	expect(detailRetryDelay(2)).toBe(1_500);
	expect(detailRetryDelay(3)).toBe(5_000);
	expect(detailRetryDelay(20)).toBe(5_000);
});

test("manual refresh cannot overlap a pending read and cancellation fences late results", async () => {
	const pending = deferred<number>();
	const { scheduler, tasks } = controlledScheduler();
	const results: number[] = [];
	let reads = 0;
	const polling = startDetailPolling({
		read: () => {
			reads++;
			return pending.promise;
		},
		isLive: () => true,
		isPermanentError: () => false,
		onResult: (result) => results.push(result),
		onError: () => {},
		scheduler,
	});
	polling.refresh();
	polling.refresh();
	expect(reads).toBe(1);
	polling.dispose();
	pending.resolve(1);
	await flushPromises();
	expect(results).toEqual([]);
	expect(tasks).toHaveLength(0);
});

test("closing a live detail clears its next timer; a settled detail never restarts on refresh", async () => {
	for (const live of [true, false]) {
		const { scheduler, tasks } = controlledScheduler();
		let reads = 0;
		const polling = startDetailPolling({
			read: async () => ++reads,
			isLive: () => live,
			isPermanentError: () => false,
			onResult: () => {},
			onError: () => {},
			scheduler,
		});
		await flushPromises();
		expect(tasks).toHaveLength(live ? 1 : 0);
		if (!live) polling.refresh();
		polling.dispose();
		expect(tasks).toHaveLength(0);
		expect(reads).toBe(1);
	}
});
