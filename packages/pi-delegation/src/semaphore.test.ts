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
});

test("resize up grants queued waiters at once; resize down holds grants until releases repay it", async () => {
	const semaphore = new Semaphore(1);
	const releaseA = await semaphore.acquire();
	let granted = 0;
	const pendingB = semaphore.acquire().then((release) => {
		granted++;
		return release;
	});
	const pendingC = semaphore.acquire().then((release) => {
		granted++;
		return release;
	});
	semaphore.resize(3);
	const releaseB = await pendingB;
	const releaseC = await pendingC;
	expect(granted).toBe(2);

	semaphore.resize(1);
	releaseA();
	releaseB();
	let dGranted = false;
	const pendingD = semaphore.acquire().then((release) => {
		dGranted = true;
		return release;
	});
	await Bun.sleep(1);
	expect(dGranted).toBe(false);
	releaseC();
	(await pendingD)();
	expect(dGranted).toBe(true);
	expect(() => semaphore.resize(0)).toThrow();
});
