import { describe, expect, test } from "bun:test";
import {
	RequestReplayCache,
	RequestReplayConflictError,
	RequestReplayOverflowError,
	RequestReplayUnretainedError,
} from "./requestReplayCache";

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
		expect(executions).toBe(0);

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

	test("a full namespace refuses new ids while still answering every id it holds", async () => {
		const cache = new RequestReplayCache<string>(2);
		let executions = 0;
		const execute = () => String(++executions);

		expect(await cache.run("page", "first", "one", execute)).toBe("1");
		expect(await cache.run("page", "second", "two", execute)).toBe("2");

		expect(() => cache.run("page", "third", "three", execute)).toThrow(RequestReplayOverflowError);
		expect(executions).toBe(2);

		expect(await cache.run("page", "first", "one", execute)).toBe("1");
		expect(await cache.run("page", "second", "two", execute)).toBe("2");

		cache.acknowledge("page", ["first"]);
		expect(await cache.run("page", "third", "three", execute)).toBe("3");
		expect(() => cache.run("page", "fourth", "four", execute)).toThrow(RequestReplayOverflowError);
	});

	test("in-flight work is never evicted to make room, and counts against admission", async () => {
		const cache = new RequestReplayCache<string>(1);
		const run = deferred<string>();
		let longExecutions = 0;
		const longRun = () => {
			longExecutions += 1;
			return run.promise;
		};
		const inFlight = cache.run("page", "long", "same", longRun);

		expect(() => cache.run("page", "other", "other", () => "no room")).toThrow(
			RequestReplayOverflowError,
		);
		expect(cache.run("page", "long", "same", longRun)).toBe(inFlight);

		run.resolve("long-result");
		expect(await inFlight).toBe("long-result");
		expect(longExecutions).toBe(1);
	});

	test("the byte budget holds even when every response is admitted before any settles", async () => {
		const cache = new RequestReplayCache<string>(100, 8);
		const gates = ["a", "b", "c"].map(() => deferred<string>());

		const flights = gates.map((gate, i) =>
			cache.run("page", `read-${i}`, `f${i}`, () => gate.promise),
		);
		for (const gate of gates) gate.resolve("12345");
		await Promise.all(flights);

		expect(await cache.run("page", "read-0", "f0", () => "reran")).toBe("12345");
		expect(() => cache.run("page", "read-1", "f1", () => "reran")).toThrow(
			RequestReplayUnretainedError,
		);
		expect(() => cache.run("page", "read-2", "f2", () => "reran")).toThrow(
			RequestReplayUnretainedError,
		);
	});

	test("a single response larger than the whole budget is recorded but not retained", async () => {
		const cache = new RequestReplayCache<string>(100, 4);
		let executions = 0;
		const huge = () => {
			executions += 1;
			return "123456789";
		};

		expect(await cache.run("page", "huge", "same", huge)).toBe("123456789");
		expect(() => cache.run("page", "huge", "same", huge)).toThrow(RequestReplayUnretainedError);
		expect(executions).toBe(1);

		expect(await cache.run("page", "small", "other", () => "ok")).toBe("ok");
		expect(await cache.run("page", "small", "other", () => "reran")).toBe("ok");
	});

	test("acknowledging frees budget for later responses", async () => {
		const cache = new RequestReplayCache<string>(100, 8);

		await cache.run("page", "first", "one", () => "12345");
		cache.acknowledge("page", ["first"]);
		await cache.run("page", "second", "two", () => "12345");
		expect(await cache.run("page", "second", "two", () => "reran")).toBe("12345");
	});

	test("acknowledged results are freed; an undelivered one is kept indefinitely", async () => {
		const cache = new RequestReplayCache<string>(2);
		let lostExecutions = 0;
		const lost = () => {
			lostExecutions += 1;
			return "first-execution";
		};

		await cache.run("page", "lost", "same", lost);
		for (const id of ["read-1", "read-2", "read-3", "read-4"]) {
			await cache.run("page", id, id, () => id);
			cache.acknowledge("page", [id]);
		}

		expect(await cache.run("page", "lost", "same", lost)).toBe("first-execution");
		expect(lostExecutions).toBe(1);
	});

	test("a receipt for work still in flight is ignored, not obeyed", async () => {
		const cache = new RequestReplayCache<string>();
		const run = deferred<string>();
		let executions = 0;
		const execute = () => {
			executions += 1;
			return run.promise;
		};

		const inFlight = cache.run("page", "picker", "same", execute);
		cache.acknowledge("page", ["picker"]);
		expect(cache.run("page", "picker", "same", execute)).toBe(inFlight);

		run.resolve("/picked/path");
		expect(await inFlight).toBe("/picked/path");
		expect(executions).toBe(1);
	});

	test("receipts for unknown ids and unknown clients are ignored", () => {
		const cache = new RequestReplayCache<string>();
		cache.run("page", "req-1", "same", () => "ok");

		expect(() => cache.acknowledge("page", ["never-sent"])).not.toThrow();
		expect(() => cache.acknowledge("ghost", ["req-1"])).not.toThrow();
	});

	test("reconnect reconciliation frees everything the page is no longer waiting on", async () => {
		const cache = new RequestReplayCache<string>(3);
		let executions = 0;
		const execute = () => String(++executions);

		await cache.run("page", "acked-but-lost", "one", () => "one");
		await cache.run("page", "also-lost", "two", () => "two");
		await cache.run("page", "still-pending", "three", () => "three");

		cache.retain("page", ["still-pending"]);

		expect(await cache.run("page", "still-pending", "three", execute)).toBe("three");
		expect(await cache.run("page", "fresh", "four", execute)).toBe("1");
	});

	test("reconnect reconciliation keeps in-flight work the page did not name", async () => {
		const cache = new RequestReplayCache<string>();
		const run = deferred<string>();
		let executions = 0;
		const execute = () => {
			executions += 1;
			return run.promise;
		};

		const inFlight = cache.run("page", "picker", "same", execute);
		cache.retain("page", []);
		expect(cache.run("page", "picker", "same", execute)).toBe(inFlight);

		run.resolve("/picked/path");
		expect(await inFlight).toBe("/picked/path");
		expect(executions).toBe(1);
	});

	test("reconciling an unknown client is a no-op", () => {
		expect(() => new RequestReplayCache<string>().retain("ghost", ["a"])).not.toThrow();
	});

	test("client retirement drops its replay namespace", async () => {
		const cache = new RequestReplayCache<string>();
		let executions = 0;
		const execute = () => String(++executions);

		expect(await cache.run("page", "req-1", "same", execute)).toBe("1");
		expect(cache.clearClient("page")).toBe(true);
		expect(await cache.run("page", "req-1", "same", execute)).toBe("2");
	});

	test("client retirement is declined, and retains everything, while a request is in flight", async () => {
		const cache = new RequestReplayCache<string>();
		const run = deferred<string>();
		let executions = 0;
		const execute = () => {
			executions += 1;
			return run.promise;
		};

		const settled = cache.run("page", "settled", "one", () => "cached");
		expect(await settled).toBe("cached");
		const inFlight = cache.run("page", "picker", "same", execute);

		expect(cache.clearClient("page")).toBe(false);
		expect(cache.run("page", "picker", "same", execute)).toBe(inFlight);
		expect(await cache.run("page", "settled", "one", () => "reran")).toBe("cached");
		expect(executions).toBe(1);

		run.resolve("/picked/path");
		expect(await inFlight).toBe("/picked/path");
		expect(cache.clearClient("page")).toBe(true);
		expect(await cache.run("page", "picker", "same", () => "fresh")).toBe("fresh");
	});

	test("retiring a client that was never seen is a no-op, not a retry", () => {
		expect(new RequestReplayCache<string>().clearClient("ghost")).toBe(true);
	});
});
