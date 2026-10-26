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

function fakeSchedule() {
	const pending: (() => void)[] = [];
	let cancelled = 0;
	return {
		schedule(run: () => void) {
			pending.push(run);
			return () => {
				cancelled += 1;
			};
		},
		flush() {
			for (const run of pending.splice(0)) run();
		},
		get scheduled() {
			return pending.length;
		},
		get cancelled() {
			return cancelled;
		},
	};
}

test("whenPageActive schedules at once on an active page and runs the task", () => {
	const page = fakeActivity(true);
	const idle = fakeSchedule();
	let runs = 0;
	whenPageActive(idle.schedule, () => runs++, page.activity);
	expect(idle.scheduled).toBe(1);
	expect(page.listeners.size).toBe(0);
	idle.flush();
	expect(runs).toBe(1);
});

test("whenPageActive waits for a hidden or offline page to become active, then schedules once", () => {
	const page = fakeActivity(false);
	const idle = fakeSchedule();
	let runs = 0;
	whenPageActive(idle.schedule, () => runs++, page.activity);
	expect(idle.scheduled).toBe(0);
	page.become(false);
	expect(idle.scheduled).toBe(0);
	page.become(true);
	page.become(true);
	expect(idle.scheduled).toBe(1);
	idle.flush();
	expect(runs).toBe(1);
	expect(page.listeners.size).toBe(0);
});

test("whenPageActive rechecks when the scheduled run fires and waits again if the page went inactive", () => {
	const page = fakeActivity(true);
	const idle = fakeSchedule();
	let runs = 0;
	whenPageActive(idle.schedule, () => runs++, page.activity);
	page.become(false);
	idle.flush();
	expect(runs).toBe(0);
	expect(idle.scheduled).toBe(0);
	page.become(true);
	expect(idle.scheduled).toBe(1);
	idle.flush();
	expect(runs).toBe(1);
	expect(page.listeners.size).toBe(0);
});

test("whenPageActive cancel stops a wait and a scheduled run", () => {
	const waiting = fakeActivity(false);
	const idle = fakeSchedule();
	let runs = 0;
	whenPageActive(idle.schedule, () => runs++, waiting.activity)();
	waiting.become(true);
	expect(idle.scheduled).toBe(0);
	expect(waiting.listeners.size).toBe(0);

	const active = fakeActivity(true);
	const cancel = whenPageActive(idle.schedule, () => runs++, active.activity);
	cancel();
	expect(idle.cancelled).toBe(1);
	expect(runs).toBe(0);
});
