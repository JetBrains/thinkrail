import { describe, expect, test } from "bun:test";
import {
	RequestReplayCache,
	RequestReplayConflictError,
	RequestReplayReclaimedError,
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
		// Two four-character results exceed the five-character target, so the oldest is reclaimed — under the
		// count ceiling alone (100) it would still be held, which is what makes this a weight bound.
		expect(() => cache.run("page", "first", "same", first)).toThrow(RequestReplayReclaimedError);
		expect(firstExecutions).toBe(1);
		expect(await cache.run("page", "second", "same", () => "reran")).toBe("5678");
	});

	// A successful `send` only says the bytes were queued. Acknowledgement is what frees a result, so a
	// client that reads its replies keeps the cache small without the ceiling ever reclaiming anything.
	test("acknowledged results are freed, so an undelivered one never meets the ceiling", async () => {
		const cache = new RequestReplayCache<string>(2);
		let lostExecutions = 0;
		const lost = () => {
			lostExecutions += 1;
			return "first-execution";
		};

		// The reply to `lost` dies with the socket and is never acknowledged. Everything after it is read.
		await cache.run("page", "lost", "same", lost);
		for (const id of ["read-1", "read-2", "read-3", "read-4"]) {
			await cache.run("page", id, id, () => id);
			cache.acknowledge("page", [id]);
		}

		// Four later results passed through a ceiling of two without displacing the one still owed.
		expect(await cache.run("page", "lost", "same", lost)).toBe("first-execution");
		expect(lostExecutions).toBe(1);
		expect(await cache.run("page", "read-1", "read-1", () => "reran")).toBe("reran");
	});

	// The ceiling still has to bound a peer that never acknowledges. It may cost that peer an *answer* — it
	// may never cost exactly-once, which is the difference between a lost reply and a second `terminal.create`.
	test("a reclaimed result fails its replay instead of executing the work twice", async () => {
		const cache = new RequestReplayCache<string>(1);
		let executions = 0;
		const mutation = () => {
			executions += 1;
			return "created";
		};

		await cache.run("page", "mutation", "same", mutation);
		await cache.run("page", "later", "other", () => "pushes the mutation past the ceiling");

		expect(() => cache.run("page", "mutation", "same", mutation)).toThrow(
			RequestReplayReclaimedError,
		);
		expect(executions).toBe(1);
		// The tombstone still knows the id, so a *conflicting* reuse is caught as the conflict it is.
		expect(() => cache.run("page", "mutation", "different", mutation)).toThrow(
			RequestReplayConflictError,
		);
		expect(executions).toBe(1);
	});

	test("acknowledging a reclaimed id drops its tombstone", async () => {
		const cache = new RequestReplayCache<string>(1);
		let executions = 0;
		const execute = () => String(++executions);

		await cache.run("page", "reclaimed", "same", execute);
		await cache.run("page", "later", "other", () => "past the ceiling");
		cache.acknowledge("page", ["reclaimed"]);

		// Acknowledged means read, so the id is free again rather than a permanently failing tombstone.
		expect(await cache.run("page", "reclaimed", "same", execute)).toBe("2");
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
		// No client can have read a response that does not exist yet; honouring this would drop the running
		// handler and let the replay below start a second one.
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

	test("client retirement drops its replay namespace", async () => {
		const cache = new RequestReplayCache<string>();
		let executions = 0;
		const execute = () => String(++executions);

		expect(await cache.run("page", "req-1", "same", execute)).toBe("1");
		expect(cache.clearClient("page")).toBe(true);
		expect(await cache.run("page", "req-1", "same", execute)).toBe("2");
	});

	// Retirement is driven by a *socket* grace window, but a request outlives it: the folder picker waits up
	// to 30 minutes on a human, and the page replays that id whenever it reconnects. Retiring mid-handler
	// would open a second picker beside the one still on screen.
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
		// Nothing was dropped: the replay joins the running handler rather than starting a second one, and the
		// already-settled sibling still answers from cache.
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
