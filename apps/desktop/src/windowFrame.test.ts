import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type DisplayBounds,
	initialWindowFrame,
	installWindowFramePersistence,
	readWindowFrame,
	visibleWindowFrame,
	type WindowFrame,
	WindowFrameStore,
} from "./windowFrame";

const roots: string[] = [];
const primary: DisplayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
const secondary: DisplayBounds = { x: 1920, y: 0, width: 1280, height: 720 };

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function framePath(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-window-frame-"));
	roots.push(root);
	const directory = join(root, "nested");
	mkdirSync(directory);
	return join(directory, "window-frame.json");
}

function fakeWindow(frame: WindowFrame) {
	const listeners = new Map<string, Array<() => void>>();
	const window = {
		fullScreen: false,
		frame,
		getFrame: () => window.frame,
		isFullScreen: () => window.fullScreen,
		on(name: string, listener: () => void) {
			listeners.set(name, [...(listeners.get(name) ?? []), listener]);
		},
		emit(name: string) {
			for (const listener of listeners.get(name) ?? []) listener();
		},
	};
	return window;
}

test("centres the first window inside the primary work area", () => {
	expect(initialWindowFrame(null, [primary, secondary])).toEqual({
		x: 240,
		y: 80,
		width: 1440,
		height: 920,
	});
});

test("shrinks the first window when the display is smaller than the default size", () => {
	const laptop: DisplayBounds = { x: 0, y: 0, width: 1280, height: 720 };
	expect(initialWindowFrame(null, [laptop])).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
});

test("restores a saved frame that is still reachable", () => {
	const saved: WindowFrame = { x: 2300, y: 10, width: 1200, height: 700 };
	expect(initialWindowFrame(saved, [primary, secondary])).toEqual(saved);
});

test("pulls an off-screen frame back onto the nearest display", () => {
	const saved: WindowFrame = { x: 4200, y: 2000, width: 1200, height: 800 };
	expect(visibleWindowFrame(saved, [primary, secondary])).toEqual({
		x: 2000,
		y: 0,
		width: 1200,
		height: 720,
	});
});

test("shrinks a saved frame that outgrew its display", () => {
	const saved: WindowFrame = { x: 100, y: 100, width: 2560, height: 1440 };
	expect(visibleWindowFrame(saved, [primary])).toEqual({
		x: 0,
		y: 0,
		width: 1920,
		height: 1080,
	});
});

test("leaves a window hanging off an edge alone when it still fits the display", () => {
	const saved: WindowFrame = { x: 1600, y: -40, width: 1200, height: 900 };
	expect(visibleWindowFrame(saved, [primary])).toEqual(saved);
});

test("keeps the saved frame when no display reports a usable area", () => {
	const saved: WindowFrame = { x: -400, y: 10, width: 1000, height: 700 };
	expect(visibleWindowFrame(saved, [{ x: 0, y: 0, width: 0, height: 0 }])).toEqual(saved);
	expect(initialWindowFrame(null, [])).toEqual({ x: 0, y: 0, width: 1440, height: 920 });
});

test("rejects frames that are unbounded, malformed, or too small", () => {
	expect(readWindowFrame(null)).toBeNull();
	expect(readWindowFrame({ x: 0, y: 0, width: 100, height: 100 })).toBeNull();
	expect(readWindowFrame({ x: 0, y: 0, width: 1440, height: 920, extra: true })).toEqual({
		x: 0,
		y: 0,
		width: 1440,
		height: 920,
	});
	expect(
		readWindowFrame({ x: Number.POSITIVE_INFINITY, y: 0, width: 1440, height: 920 }),
	).toBeNull();
	expect(readWindowFrame({ x: 0, y: 0, width: 1440 })).toBeNull();
	expect(readWindowFrame("1440x920")).toBeNull();
});

test("round-trips a frame and reads it back through a fresh store", () => {
	const path = framePath();
	const store = new WindowFrameStore(path);
	expect(store.read()).toBeNull();
	expect(store.write({ x: 12.4, y: 8.6, width: 1500.2, height: 940.5 })).toBe(true);
	expect(new WindowFrameStore(path).read()).toEqual({ x: 12, y: 9, width: 1500, height: 941 });
});

test("refuses an invalid frame without creating the document", () => {
	const path = framePath();
	expect(new WindowFrameStore(path).write({ x: 0, y: 0, width: 10, height: 10 })).toBe(false);
	expect(existsSync(path)).toBe(false);
});

test("falls back to centring from corrupt or unsupported documents", () => {
	for (const contents of [
		"{",
		"[]",
		JSON.stringify({ version: 99, frame: { x: 10, y: 10, width: 1440, height: 920 } }),
		JSON.stringify({ version: 1, frame: { x: 10, y: 10, width: 1, height: 1 } }),
		JSON.stringify({ version: 1 }),
	]) {
		const path = framePath();
		writeFileSync(path, contents);
		expect(new WindowFrameStore(path).read()).toBeNull();
	}
});

test("saves the frame after a move settles, and on close without waiting", async () => {
	const store = new WindowFrameStore(framePath());
	const window = fakeWindow({ x: 100, y: 50, width: 1440, height: 920 });
	installWindowFramePersistence(window, store, 5);

	window.frame = { x: 300, y: 150, width: 1440, height: 920 };
	window.emit("move");
	window.emit("move");
	expect(store.read()).toBeNull();
	await Bun.sleep(40);
	expect(store.read()).toEqual({ x: 300, y: 150, width: 1440, height: 920 });

	window.frame = { x: 320, y: 170, width: 1200, height: 800 };
	window.emit("resize");
	window.emit("will-close");
	expect(store.read()).toEqual({ x: 320, y: 170, width: 1200, height: 800 });
	await Bun.sleep(40);
	expect(store.read()).toEqual({ x: 320, y: 170, width: 1200, height: 800 });
});

test("keeps the last windowed frame while the window is full screen", async () => {
	const path = framePath();
	const store = new WindowFrameStore(path);
	const window = fakeWindow({ x: 100, y: 50, width: 1440, height: 920 });
	installWindowFramePersistence(window, store, 5);

	window.fullScreen = true;
	window.frame = { x: 0, y: 0, width: 1920, height: 1080 };
	window.emit("resize");
	await Bun.sleep(40);
	expect(store.read()).toBeNull();

	window.fullScreen = false;
	window.frame = { x: 100, y: 50, width: 1440, height: 920 };
	window.emit("move");
	await Bun.sleep(40);
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
		version: 1,
		frame: { x: 100, y: 50, width: 1440, height: 920 },
	});
});
