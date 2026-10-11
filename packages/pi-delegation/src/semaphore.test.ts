import { expect, test } from "bun:test";
import { Semaphore } from "./semaphore";

test("grants up to the slot count immediately, then queues FIFO", async () => {
	const semaphore = new Semaphore(2);
	const order: string[] = [];

	const releaseA = await semaphore.acquire();
	const releaseB = await semaphore.acquire();
	const pendingC = semaphore.acquire().then((release) => {
		order.push("c");
		return release;
	});
	const pendingD = semaphore.acquire().then((release) => {
		order.push("d");
		return release;
	});

	await Bun.sleep(1);
	expect(order).toEqual([]);

	releaseA();
	const releaseC = await pendingC;
	expect(order).toEqual(["c"]);

	releaseB();
	const releaseD = await pendingD;
	expect(order).toEqual(["c", "d"]);

	releaseC();
	releaseD();
	const releaseE = await semaphore.acquire();
	releaseE();
});

test("a double release does not mint an extra slot", async () => {
	const semaphore = new Semaphore(1);
	const release = await semaphore.acquire();
	release();
	release();
	const release2 = await semaphore.acquire();
	let thirdGranted = false;
	void semaphore.acquire().then(() => {
		thirdGranted = true;
	});
	await Bun.sleep(1);
	expect(thirdGranted).toBe(false);
	release2();
});

test("rejects a non-positive slot count", () => {
	expect(() => new Semaphore(0)).toThrow();
	expect(() => new Semaphore(1).resize(0)).toThrow();
	expect(() => new Semaphore(1).resize(1.5)).toThrow();
});

test("growing admits queued waiters at once, in FIFO order", async () => {
	const semaphore = new Semaphore(1);
	const order: string[] = [];
	const releaseA = await semaphore.acquire();
	const pending = ["b", "c", "d"].map((name) =>
		semaphore.acquire().then((release) => {
			order.push(name);
			return release;
		}),
	);
	await Bun.sleep(1);
	expect(order).toEqual([]);

	semaphore.resize(3);
	const [releaseB, releaseC] = await Promise.all(pending.slice(0, 2));
	await Bun.sleep(1);
	expect(order).toEqual(["b", "c"]);

	releaseA();
	const releaseD = await pending[2];
	expect(order).toEqual(["b", "c", "d"]);
	for (const release of [releaseB, releaseC, releaseD]) release?.();
});

test("shrinking keeps current holders and admits only below the new limit", async () => {
	const semaphore = new Semaphore(3);
	const releases = await Promise.all([
		semaphore.acquire(),
		semaphore.acquire(),
		semaphore.acquire(),
	]);
	semaphore.resize(1);
	let granted = false;
	const pending = semaphore.acquire().then((release) => {
		granted = true;
		return release;
	});

	releases[0]?.();
	releases[1]?.();
	await Bun.sleep(1);
	expect(granted).toBe(false);

	releases[2]?.();
	const release = await pending;
	expect(granted).toBe(true);
	release();
});
