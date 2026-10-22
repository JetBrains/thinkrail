import { afterEach, expect, test } from "bun:test";
import { whenIdle } from "./idle";

const original = {
	request: globalThis.requestIdleCallback,
	cancel: globalThis.cancelIdleCallback,
};

afterEach(() => {
	globalThis.requestIdleCallback = original.request;
	globalThis.cancelIdleCallback = original.cancel;
});

function stubIdleCallback() {
	const calls: { run: () => void; timeout: number | undefined }[] = [];
	const cancelled: number[] = [];
	globalThis.requestIdleCallback = (run, options) => calls.push({ run, timeout: options?.timeout });
	globalThis.cancelIdleCallback = (handle) => cancelled.push(handle);
	return { calls, cancelled };
}

test("whenIdle schedules on requestIdleCallback with the timeout", () => {
	const idle = stubIdleCallback();
	let runs = 0;
	whenIdle(() => runs++, { timeout: 2000, fallbackDelay: 5 });
	expect(idle.calls.map((call) => call.timeout)).toEqual([2000]);
	expect(runs).toBe(0);
	idle.calls[0]?.run();
	expect(runs).toBe(1);
});

test("whenIdle cancel releases the idle callback", () => {
	const idle = stubIdleCallback();
	const cancel = whenIdle(() => {}, { timeout: 2000, fallbackDelay: 5 });
	cancel();
	expect(idle.cancelled).toEqual([1]);
});

test("whenIdle falls back to a timer without requestIdleCallback", async () => {
	Reflect.deleteProperty(globalThis, "requestIdleCallback");
	let runs = 0;
	whenIdle(() => runs++, { timeout: 2000, fallbackDelay: 1 });
	expect(runs).toBe(0);
	await Bun.sleep(10);
	expect(runs).toBe(1);
});

test("whenIdle cancel stops the fallback timer", async () => {
	Reflect.deleteProperty(globalThis, "requestIdleCallback");
	let runs = 0;
	const cancel = whenIdle(() => runs++, { timeout: 2000, fallbackDelay: 1 });
	cancel();
	await Bun.sleep(10);
	expect(runs).toBe(0);
});
