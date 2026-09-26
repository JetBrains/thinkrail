import { afterEach, beforeEach, expect, test } from "bun:test";
import { onThemeSwap, recordThemeApplication } from "./swap";

let frames: (() => void)[] = [];
const flushFrame = () => {
	const pending = frames;
	frames = [];
	for (const run of pending) run();
};

beforeEach(() => {
	frames = [];
	Reflect.set(globalThis, "requestAnimationFrame", (run: () => void) => frames.push(run));
});

afterEach(() => {
	flushFrame();
	Reflect.deleteProperty(globalThis, "requestAnimationFrame");
});

test("changes within one frame notify once, and a no-op or reverted change notifies nothing", () => {
	let calls = 0;
	const stop = onThemeSwap(() => calls++);
	expect(recordThemeApplication("coalesce-a")).toBe(true);
	expect(recordThemeApplication("coalesce-b")).toBe(true);
	expect(recordThemeApplication("coalesce-b")).toBe(false);
	expect(calls).toBe(0);
	flushFrame();
	expect(calls).toBe(1);
	recordThemeApplication("coalesce-c");
	recordThemeApplication("coalesce-b");
	flushFrame();
	expect(calls).toBe(1);
	stop();
	recordThemeApplication("coalesce-d");
	flushFrame();
	expect(calls).toBe(1);
});

test("a settled subscriber runs on the first change, then once after changes stop", async () => {
	let calls = 0;
	const stop = onThemeSwap(() => calls++, { settle: true });
	for (const step of [1, 2, 3, 4]) {
		recordThemeApplication(`settle-${step}`);
		flushFrame();
	}
	expect(calls).toBe(1);
	await Bun.sleep(200);
	expect(calls).toBe(2);
	recordThemeApplication("settle-5");
	flushFrame();
	expect(calls).toBe(3);
	stop();
});

test("unsubscribing a settled subscriber cancels its trailing call", async () => {
	let calls = 0;
	const stop = onThemeSwap(() => calls++, { settle: true });
	recordThemeApplication("cancel-1");
	flushFrame();
	recordThemeApplication("cancel-2");
	flushFrame();
	stop();
	await Bun.sleep(200);
	expect(calls).toBe(1);
});
