import { describe, expect, test } from "bun:test";
import { RequestReplayCache, RequestReplayConflictError } from "./requestReplayCache";

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (error: Error) => void = () => {};
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

describe("request replay cache", () => {
	test("concurrent and settled replays execute once and share the result", async () => {
		const cache = new RequestReplayCache<string>();
		const run = deferred<string>();
		let executions = 0;
		const execute = () => {
			executions += 1;
			return run.promise;
		};

		const first = cache.run("page", "req-1", "same", execute);
		const concurrent = cache.run("page", "req-1", "same", execute);
		expect(concurrent).toBe(first);
		expect(executions).toBe(0); // execution starts on the cache's next microtask

		run.resolve("done");
		expect(await first).toBe("done");
		expect(await concurrent).toBe("done");
		expect(await cache.run("page", "req-1", "same", execute)).toBe("done");
		expect(executions).toBe(1);
	});

	test("replays the same rejection instead of rerunning a failed mutation", async () => {
		const cache = new RequestReplayCache<string>();
		const failure = new Error("refused");
		let executions = 0;
		const execute = () => {
			executions += 1;
			throw failure;
		};

		const first = cache.run("page", "req-1", "same", execute);
		await expect(first).rejects.toBe(failure);
		await expect(cache.run("page", "req-1", "same", execute)).rejects.toBe(failure);
		expect(executions).toBe(1);
	});

	test("rejects an id reused for a different payload", () => {
		const cache = new RequestReplayCache<string>();
		cache.run("page", "req-1", "method-a", () => "ok");

		expect(() => cache.run("page", "req-1", "method-b", () => "wrong")).toThrow(
			RequestReplayConflictError,
		);
	});

	test("bounds settled results without evicting in-flight work", async () => {
		const cache = new RequestReplayCache<string>(1);
		const run = deferred<string>();
		let longExecutions = 0;
		const longRun = () => {
			longExecutions += 1;
			return run.promise;
		};
		const inFlight = cache.run("page", "long", "same", longRun);

		await cache.run("page", "short-1", "one", () => "one");
		await cache.run("page", "short-2", "two", () => "two");
		const replay = cache.run("page", "long", "same", longRun);
		expect(replay).toBe(inFlight);

		run.resolve("long-result");
		expect(await replay).toBe("long-result");
		expect(longExecutions).toBe(1);
	});

	test("bounds settled serialized-result weight, not only entry count", async () => {
		const cache = new RequestReplayCache<string>(100, 5);
		let firstExecutions = 0;
		const first = () => {
			firstExecutions += 1;
			return "1234";
		};

		await cache.run("page", "first", "same", first);
		await cache.run("page", "second", "same", () => "5678");
		// Two four-character results exceed the five-character target, so the oldest settled result is evicted.
		expect(await cache.run("page", "first", "same", first)).toBe("1234");
		expect(firstExecutions).toBe(2);
	});

	test("client retirement drops its replay namespace", async () => {
		const cache = new RequestReplayCache<string>();
		let executions = 0;
		const execute = () => String(++executions);

		expect(await cache.run("page", "req-1", "same", execute)).toBe("1");
		cache.clearClient("page");
		expect(await cache.run("page", "req-1", "same", execute)).toBe("2");
	});
});
