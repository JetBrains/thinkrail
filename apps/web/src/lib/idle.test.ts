import { afterEach, expect, test } from "bun:test";
import { type PageActivity, whenIdle, whenPageActive } from "./idle";

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

function fakeActivity(active: boolean) {
	let isActive = active;
	const listeners = new Set<() => void>();
	const activity: PageActivity = {
		active: () => isActive,
		subscribe(onChange) {
			listeners.add(onChange);
			return () => listeners.delete(onChange);
		},
	};
	return {
		activity,
		listeners,
		become(next: boolean) {
			isActive = next;
			for (const listener of [...listeners]) listener();
		},
	};
}

test("whenPageActive starts at once on an active page and stops through its cancel", () => {
	const page = fakeActivity(true);
	const events: string[] = [];
	const cancel = whenPageActive(() => {
		events.push("start");
		return () => events.push("stop");
	}, page.activity);
	expect(events).toEqual(["start"]);
	expect(page.listeners.size).toBe(0);
	cancel();
	expect(events).toEqual(["start", "stop"]);
});

test("whenPageActive waits for a hidden or offline page to become active, then starts once", () => {
	const page = fakeActivity(false);
	let starts = 0;
	whenPageActive(() => {
		starts += 1;
		return () => {};
	}, page.activity);
	expect(starts).toBe(0);
	page.become(false);
	expect(starts).toBe(0);
	page.become(true);
	page.become(true);
	expect(starts).toBe(1);
	expect(page.listeners.size).toBe(0);
});

test("whenPageActive cancelled while waiting never starts", () => {
	const page = fakeActivity(false);
	let starts = 0;
	const cancel = whenPageActive(() => {
		starts += 1;
		return () => {};
	}, page.activity);
	cancel();
	page.become(true);
	expect(starts).toBe(0);
	expect(page.listeners.size).toBe(0);
});
