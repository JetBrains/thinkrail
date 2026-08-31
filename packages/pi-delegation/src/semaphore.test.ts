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
