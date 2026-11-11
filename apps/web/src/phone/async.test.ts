import { expect, test } from "bun:test";
import { singleFlight } from "./async";

test("a second tap while an action is in flight is dropped, and the next one after it settles runs", async () => {
	const pending: boolean[] = [];
	const flight = singleFlight((next) => pending.push(next));
	let finish = (): void => {};
	const first = flight(() => new Promise<string>((resolve) => (finish = () => resolve("done"))));
	expect(flight(async () => "twice")).toBeNull();
	expect(pending).toEqual([true]);
	finish();
	expect(await first).toBe("done");
	expect(pending).toEqual([true, false]);
	expect(await flight(async () => "again")).toBe("again");
});

test("a failed action releases the lock and still rejects to its caller", async () => {
	const flight = singleFlight();
	const failed = flight(async () => {
		throw new Error("offline");
	});
	expect(await failed?.catch((error: Error) => error.message)).toBe("offline");
	expect(await flight(async () => 1)).toBe(1);
});
