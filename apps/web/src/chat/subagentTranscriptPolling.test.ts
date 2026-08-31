import { expect, test } from "bun:test";
import {
	SUBAGENT_TRANSCRIPT_POLL_MS,
	startSubagentTranscriptPolling,
	subagentTranscriptRetryDelay,
	type TranscriptPollScheduler,
} from "./subagentTranscriptPolling";

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
	const scheduler: TranscriptPollScheduler = {
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

	const stop = startSubagentTranscriptPolling({
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
	expect(tasks.map((task) => task.delayMs)).toEqual([SUBAGENT_TRANSCRIPT_POLL_MS]);

	runNext();
	expect(readCount).toBe(2);
	expect(tasks).toHaveLength(0);
	second.resolve({ status: "completed", revision: 2 });
	await flushPromises();
	expect(results).toEqual([1, 2]);
	expect(tasks).toHaveLength(0);
	stop();
});

test("transient failures back off while a permanent miss stops polling", async () => {
	const transient = new Error("offline");
	const permanent = new Error("missing");
	const errors: unknown[] = [];
	const { scheduler, tasks, runNext } = controlledScheduler();
	let readCount = 0;

	startSubagentTranscriptPolling({
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
	expect(subagentTranscriptRetryDelay(1)).toBe(500);
	expect(subagentTranscriptRetryDelay(2)).toBe(1_500);
	expect(subagentTranscriptRetryDelay(3)).toBe(5_000);
	expect(subagentTranscriptRetryDelay(20)).toBe(5_000);
});
