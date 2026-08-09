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

	// The bound refuses NEW work; it never reaches back for an answer already owed. That direction is the whole
	// invariant: a refused request provably did not run, whereas a discarded result can be replayed into a
	// second execution.
	test("a full namespace refuses new ids while still answering every id it holds", async () => {
		const cache = new RequestReplayCache<string>(2);
		let executions = 0;
		const execute = () => String(++executions);

		expect(await cache.run("page", "first", "one", execute)).toBe("1");
		expect(await cache.run("page", "second", "two", execute)).toBe("2");

		expect(() => cache.run("page", "third", "three", execute)).toThrow(RequestReplayOverflowError);
		expect(executions).toBe(2); // the refused handler never ran

		// Everything already admitted is still replayable — a full namespace stops taking work, it does not
		// stop owing answers.
		expect(await cache.run("page", "first", "one", execute)).toBe("1");
		expect(await cache.run("page", "second", "two", execute)).toBe("2");

		// Reading one response makes room for exactly one more.
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

	// Admission cannot police bytes: a handler's output size is unknown until it finishes, and in-flight work
	// weighs nothing. Checked only on the way in, a few concurrent large reads settle far past the budget and,
	// since nothing is ever evicted, stay there. So the byte budget is enforced on the way out instead.
	test("the byte budget holds even when every response is admitted before any settles", async () => {
		const cache = new RequestReplayCache<string>(100, 8);
		const gates = ["a", "b", "c"].map(() => deferred<string>());

		// All three admitted while empty — exactly the window an admission-time byte check cannot see.
		const flights = gates.map((gate, i) =>
			cache.run("page", `read-${i}`, `f${i}`, () => gate.promise),
		);
		for (const gate of gates) gate.resolve("12345"); // 5 chars each, 15 against a budget of 8
		await Promise.all(flights);

		// First fits; the rest would breach the budget, so their answers are dropped rather than retained.
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

		// The caller still gets its answer — only the retained copy is refused.
		expect(await cache.run("page", "huge", "same", huge)).toBe("123456789");
		expect(() => cache.run("page", "huge", "same", huge)).toThrow(RequestReplayUnretainedError);
		expect(executions).toBe(1); // never a second execution, which is the whole point

		// And it cost the budget nothing, so a later result of a workable size is still retained.
		expect(await cache.run("page", "small", "other", () => "ok")).toBe("ok");
		expect(await cache.run("page", "small", "other", () => "reran")).toBe("ok");
	});

	test("acknowledging frees budget for later responses", async () => {
		const cache = new RequestReplayCache<string>(100, 8);

		await cache.run("page", "first", "one", () => "12345");
		cache.acknowledge("page", ["first"]);
		// Without the release this would breach the 8-char budget and be dropped.
		await cache.run("page", "second", "two", () => "12345");
		expect(await cache.run("page", "second", "two", () => "reran")).toBe("12345");
	});

	// A successful `send` only says the bytes were queued. Acknowledgement is what frees a result, and it is
	// the only thing that does — nothing here evicts.
	test("acknowledged results are freed; an undelivered one is kept indefinitely", async () => {
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

		// Four later results passed through a namespace of two without displacing the one still owed.
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

	// A receipt can die in a socket buffer exactly like a response can, and nothing would ever re-send it: the
	// page dropped that request from `pending` the moment it resolved. Restating the live set on reconnect is
	// what stops one lost receipt from pinning a result until the page retires.
	test("reconnect reconciliation frees everything the page is no longer waiting on", async () => {
		const cache = new RequestReplayCache<string>(3);
		let executions = 0;
		const execute = () => String(++executions);

		await cache.run("page", "acked-but-lost", "one", () => "one");
		await cache.run("page", "also-lost", "two", () => "two");
		await cache.run("page", "still-pending", "three", () => "three");

		// The page comes back waiting on exactly one of the three; the receipts for the others never arrived.
		cache.retain("page", ["still-pending"]);

		expect(await cache.run("page", "still-pending", "three", execute)).toBe("three");
		// Room reclaimed without any receipt having landed.
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
		// A page that reconnects mid-handler may legitimately omit an id it has since timed out on. Dropping a
		// *running* handler is still the one thing that could produce a duplicate, so it is kept regardless.
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
