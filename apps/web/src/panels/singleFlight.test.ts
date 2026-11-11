import { expect, test } from "bun:test";
import { createSingleFlight } from "./singleFlight";

function deferred() {
	let resolve = () => {};
	let reject = (_error: unknown) => {};
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const flush = async () => {
	for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

test("triggers during a flight fold into exactly one follow-up that runs the latest task", async () => {
	const flight = createSingleFlight();
	const first = deferred();
	const ran: string[] = [];
	flight.run(() => {
		ran.push("first");
		return first.promise;
	});
	for (const name of ["a", "b", "c"]) flight.run(() => ran.push(name));
	expect(ran).toEqual(["first"]);
	first.resolve();
	await flush();
	expect(ran).toEqual(["first", "c"]);
	flight.run(() => ran.push("after"));
	await flush();
	expect(ran).toEqual(["first", "c", "after"]);
});

test("stop during a flight drops the follow-up and blocks later runs", async () => {
	const flight = createSingleFlight();
	const first = deferred();
	const ran: string[] = [];
	flight.run(() => first.promise);
	flight.run(() => ran.push("queued"));
	flight.stop();
	expect(flight.isStopped()).toBe(true);
	first.resolve();
	await flush();
	flight.run(() => ran.push("late"));
	await flush();
	expect(ran).toEqual([]);
});

test("a rejecting task releases the flight", async () => {
	const flight = createSingleFlight();
	const first = deferred();
	const ran: string[] = [];
	flight.run(() => first.promise);
	flight.run(() => ran.push("next"));
	first.reject(new Error("boom"));
	await flush();
	expect(ran).toEqual(["next"]);
});

test("a task that throws synchronously releases the flight", async () => {
	const flight = createSingleFlight();
	const ran: string[] = [];
	flight.run(() => {
		throw new Error("sync");
	});
	flight.run(() => ran.push("next"));
	await flush();
	expect(ran).toEqual(["next"]);
	flight.run(() => ran.push("again"));
	await flush();
	expect(ran).toEqual(["next", "again"]);
});
