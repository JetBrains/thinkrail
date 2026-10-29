import { describe, expect, test } from "bun:test";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import {
	AbandonmentReportBudget,
	heaviestReplayMethod,
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

	test("an overflow is coded and names what the namespace holds once per episode", async () => {
		const cache = new RequestReplayCache<string>(10);
		const hung = deferred<string>();
		void cache.run("page", "h1", "h1", () => hung.promise, "git.status");
		void cache.run("page", "h2", "h2", () => hung.promise, "git.status");
		for (let i = 0; i < 8; i++)
			await cache.run("page", `s${i}`, `s${i}`, () => "done", "session.resources");

		const overflow = (id: string) => {
			try {
				void cache.run("page", id, id, () => "x", "session.resources");
			} catch (error) {
				return error as RequestReplayOverflowError;
			}
			throw new Error("expected an overflow");
		};
		const first = overflow("refused-1");
		expect(first.code).toBe("REQUEST_REPLAY_OVERFLOW");
		expect(errorCodeOf(first)).toBe("REQUEST_REPLAY_OVERFLOW");
		expect(first.message).not.toContain("page");
		expect(first.load).toEqual({
			"git.status": { pending: 2, settled: 0, abandoned: 0 },
			"session.resources": { pending: 0, settled: 8, abandoned: 0 },
		});
		expect(heaviestReplayMethod(first.load ?? {})).toBe("session.resources");
		expect(overflow("refused-2").load).toBeNull();

		cache.acknowledge("page", ["s0"]);
		await cache.run("page", "near-cap", "near-cap", () => "ok");
		expect(overflow("refused-3").load).toBeNull();

		cache.acknowledge("page", ["s1", "s2"]);
		await cache.run("page", "below-low-water", "below-low-water", () => "ok");
		await cache.run("page", "refill", "refill", () => "ok");
		expect(overflow("refused-4").load).toEqual({
			"git.status": { pending: 2, settled: 0, abandoned: 0 },
			"session.resources": { pending: 0, settled: 5, abandoned: 0 },
			"unknown method": { pending: 0, settled: 3, abandoned: 0 },
		});
	});

	test("the heaviest method is the largest occupant, then the most pending, then by name", () => {
		expect(heaviestReplayMethod({})).toBeUndefined();
		expect(
			heaviestReplayMethod({
				"git.status": { pending: 1, settled: 0, abandoned: 0 },
				"fs.readFile": { pending: 0, settled: 12, abandoned: 0 },
			}),
		).toBe("fs.readFile");
		expect(
			heaviestReplayMethod({
				"fs.readFile": { pending: 0, settled: 2, abandoned: 0 },
				"git.status": { pending: 2, settled: 0, abandoned: 0 },
			}),
		).toBe("git.status");
		expect(
			heaviestReplayMethod({
				"session.resources": { pending: 1, settled: 1, abandoned: 0 },
				"fs.readFile": { pending: 1, settled: 1, abandoned: 0 },
			}),
		).toBe("fs.readFile");
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

	test("a receipt for work still in flight abandons it: joined while running, dropped once settled", async () => {
		const cache = new RequestReplayCache<string>();
		const run = deferred<string>();
		let executions = 0;
		const execute = () => {
			executions += 1;
			return run.promise;
		};

		const inFlight = cache.run("page", "picker", "same", execute, "dialog.pickDirectory");
		expect(cache.acknowledge("page", ["picker"])).toEqual(["dialog.pickDirectory"]);
		expect(cache.acknowledge("page", ["picker"])).toEqual([]);
		expect(cache.run("page", "picker", "same", execute)).toBe(inFlight);

		run.resolve("/picked/path");
		expect(await inFlight).toBe("/picked/path");
		expect(executions).toBe(1);
		await Promise.resolve();
		expect(await cache.run("page", "picker", "same", () => "not retained")).toBe("not retained");
	});

	test("abandoned work frees live slots, still counts toward the tracked ceiling, and leaves both when it settles", async () => {
		const cache = new RequestReplayCache<string>(2, undefined, 4);
		const hung = deferred<string>();
		const a = cache.run("page", "a", "a", () => hung.promise, "git.status");
		const b = cache.run("page", "b", "b", () => hung.promise, "git.status");
		expect(() => cache.run("page", "c", "c", () => "no room")).toThrow(RequestReplayOverflowError);

		cache.acknowledge("page", ["a"]);
		cache.retain("page", []);
		expect(await cache.run("page", "c", "c", () => "room")).toBe("room");
		expect(await cache.run("page", "d", "d", () => "room")).toBe("room");
		expect(() => cache.run("page", "e", "e", () => "x")).toThrow(RequestReplayOverflowError);

		hung.resolve("late");
		expect(await a).toBe("late");
		expect(await b).toBe("late");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(() => cache.run("page", "e", "e", () => "x")).toThrow(RequestReplayOverflowError);

		for (const cycle of [1, 2]) {
			const again = deferred<string>();
			cache.acknowledge("page", cycle === 1 ? ["c", "d"] : ["f", "g"]);
			const first = cache.run("page", `h${cycle}`, `h${cycle}`, () => again.promise);
			const second = cache.run("page", `i${cycle}`, `i${cycle}`, () => again.promise);
			cache.retain("page", []);
			again.resolve("late");
			await Promise.all([first, second]);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(await cache.run("page", cycle === 1 ? "f" : "j", "f1", () => "ok")).toBe("ok");
			expect(await cache.run("page", cycle === 1 ? "g" : "k", "g1", () => "ok")).toBe("ok");
			expect(() => cache.run("page", `full${cycle}`, "x", () => "x")).toThrow(
				RequestReplayOverflowError,
			);
		}
	});

	test("the tracked ceiling refuses admission even with live slots free, and names the abandoned occupant", () => {
		const cache = new RequestReplayCache<string>(2, undefined, 3);
		const hung = new Promise<string>(() => {});
		void cache.run("page", "a", "a", () => hung, "session.resources");
		void cache.run("page", "b", "b", () => hung, "session.resources");
		expect(cache.acknowledge("page", ["a", "b"])).toEqual([
			"session.resources",
			"session.resources",
		]);
		void cache.run("page", "c", "c", () => hung, "git.status");

		let refused: RequestReplayOverflowError | undefined;
		try {
			void cache.run("page", "d", "d", () => "x", "git.status");
		} catch (error) {
			refused = error as RequestReplayOverflowError;
		}
		expect(refused?.load).toEqual({
			"session.resources": { pending: 0, settled: 0, abandoned: 2 },
			"git.status": { pending: 1, settled: 0, abandoned: 0 },
		});
		expect(heaviestReplayMethod(refused?.load ?? {})).toBe("session.resources");
	});

	test("abandoned work still running declines client retirement, so reap cleanup never races it", async () => {
		const cache = new RequestReplayCache<string>();
		const hung = deferred<string>();
		const run = cache.run("page", "probe", "probe", () => hung.promise, "mcp.testConnection");
		cache.acknowledge("page", ["probe"]);
		expect(cache.clearClient("page")).toBe(false);
		hung.resolve("done");
		await run;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(cache.clearClient("page")).toBe(true);
	});

	test("abandonment reports admit each method once and stop at a fixed allowance", () => {
		const budget = new AbandonmentReportBudget(2);
		expect(budget.admit("session.resources")).toBe(true);
		expect(budget.admit("session.resources")).toBe(false);
		expect(budget.admit("git.status")).toBe(true);
		expect(budget.admit("fs.readFile")).toBe(false);
		expect(budget.admit("git.status")).toBe(false);
	});

	test("a replaced namespace is never charged by the old one's late settlement", async () => {
		const cache = new RequestReplayCache<string>(1);
		const old = deferred<string>();
		const first = cache.run("page", "a", "a", () => old.promise);
		cache.acknowledge("page", ["a"]);
		cache.clear();
		const replacement = deferred<string>();
		const second = cache.run("page", "a", "a", () => replacement.promise);

		old.resolve("old");
		expect(await first).toBe("old");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(cache.run("page", "a", "a", () => "rerun")).toBe(second);
		expect(() => cache.run("page", "b", "b", () => "x")).toThrow(RequestReplayOverflowError);
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

	test("reconnect reconciliation abandons in-flight work the page did not name", async () => {
		const cache = new RequestReplayCache<string>();
		const run = deferred<string>();
		let executions = 0;
		const execute = () => {
			executions += 1;
			return run.promise;
		};

		const inFlight = cache.run("page", "picker", "same", execute, "git.status");
		const named = cache.run("page", "named", "named", () => new Promise<string>(() => {}));
		expect(cache.retain("page", ["named"])).toEqual(["git.status"]);
		expect(cache.run("page", "picker", "same", execute)).toBe(inFlight);
		expect(cache.run("page", "named", "named", execute)).toBe(named);

		run.resolve("/picked/path");
		expect(await inFlight).toBe("/picked/path");
		expect(executions).toBe(1);
		await Promise.resolve();
		expect(await cache.run("page", "picker", "same", () => "not retained")).toBe("not retained");
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
