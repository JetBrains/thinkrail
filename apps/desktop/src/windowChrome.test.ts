import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
	createWindowChromeStyleWriter,
	desktopWindowChrome,
	INITIAL_WINDOW_CHROME_GLOBAL,
	injectInitialWindowChrome,
	installWindowChromeGeometry,
	installWindowChromePublisher,
	MAX_WINDOW_CHROME_INSET,
	readWindowChromeFlag,
	readWindowChromeGeometry,
	windowChromeGeometry,
	windowChromePreloadSeed,
} from "./windowChrome";

test("macOS hides the native strip, reserves its zone, and opts into dragging", () => {
	expect(desktopWindowChrome("darwin")).toEqual({
		titleBarStyle: "hiddenInset",
		trafficLightOffset: { x: 0, y: 4 },
		geometry: { insetLeft: 64, insetRight: 0 },
		dragRegion: true,
		windowControls: false,
		restoreFrameControls: false,
	});
});

test("Windows uses frameless web controls and restores the frame style", () => {
	expect(desktopWindowChrome("win32")).toEqual({
		titleBarStyle: "hiddenInset",
		trafficLightOffset: null,
		geometry: { insetLeft: 0, insetRight: 138 },
		dragRegion: true,
		windowControls: true,
		restoreFrameControls: true,
	});
});

test("other platforms keep the default native chrome and do not drag", () => {
	for (const platform of ["linux", "freebsd"] as const) {
		expect(desktopWindowChrome(platform)).toEqual({
			titleBarStyle: "default",
			trafficLightOffset: null,
			geometry: { insetLeft: 0, insetRight: 0 },
			dragRegion: false,
			windowControls: false,
			restoreFrameControls: false,
		});
	}
});

test("native fullscreen collapses both insets and restores them afterwards", () => {
	const policy = { ...desktopWindowChrome("darwin"), geometry: { insetLeft: 64, insetRight: 22 } };
	expect(windowChromeGeometry(policy, true)).toEqual({ insetLeft: 0, insetRight: 0 });
	expect(windowChromeGeometry(policy, false)).toEqual(policy.geometry);
});

test("geometry payloads accept only finite non-negative bounded insets", () => {
	expect(readWindowChromeGeometry({ insetLeft: 64, insetRight: 0 })).toEqual({
		insetLeft: 64,
		insetRight: 0,
	});
	expect(readWindowChromeGeometry({ insetLeft: 0, insetRight: MAX_WINDOW_CHROME_INSET })).toEqual({
		insetLeft: 0,
		insetRight: MAX_WINDOW_CHROME_INSET,
	});
	for (const malformed of [
		null,
		[],
		"64",
		{ insetLeft: 64 },
		{ insetLeft: -1, insetRight: 0 },
		{ insetLeft: Number.NaN, insetRight: 0 },
		{ insetLeft: Number.POSITIVE_INFINITY, insetRight: 0 },
		{ insetLeft: MAX_WINDOW_CHROME_INSET + 1, insetRight: 0 },
		{ insetLeft: "64", insetRight: 0 },
		{ insetLeft: 64, insetRight: 0, extra: true, __proto__: { polluted: true } },
	]) {
		const read = readWindowChromeGeometry(malformed);
		if (read) expect(Object.keys(read)).toEqual(["insetLeft", "insetRight"]);
		else expect(read).toBeNull();
	}
});

test("drag-region payloads accept only boolean fields", () => {
	expect(
		readWindowChromeFlag({ insetLeft: 64, insetRight: 0, dragRegion: true }, "dragRegion"),
	).toBe(true);
	expect(readWindowChromeFlag({ windowControls: true }, "windowControls")).toBe(true);
	expect(readWindowChromeFlag({ dragRegion: false }, "dragRegion")).toBe(false);
	expect(readWindowChromeFlag({ dragRegion: false }, "dragRegion")).toBe(false);
	for (const malformed of [null, [], "drag", {}, { dragRegion: "drag" }]) {
		expect(readWindowChromeFlag(malformed, "dragRegion")).toBeNull();
	}
});

test("window chrome preload seeds include the web controls policy", () => {
	expect(windowChromePreloadSeed(desktopWindowChrome("win32"))).toEqual({
		insetLeft: 0,
		insetRight: 138,
		dragRegion: true,
		windowControls: true,
	});
});

test("the style writer keeps the latest geometry until the document root exists", () => {
	let style: { setProperty(property: string, value: string): void } | null = null;
	const writes: Array<[property: string, value: string]> = [];
	const writer = createWindowChromeStyleWriter(() => style);
	writer.update({ insetLeft: 64, insetRight: 0, dragRegion: true });
	writer.update({ insetLeft: 12, insetRight: 8, dragRegion: false });
	expect(writes).toEqual([]);

	style = { setProperty: (property, value) => writes.push([property, value]) };
	writer.flush();
	expect(writes).toEqual([
		["--window-chrome-inset-left", "12px"],
		["--window-chrome-inset-right", "8px"],
		["--window-chrome-drag-region", "no-drag"],
	]);
	writer.update({ insetLeft: "invalid", insetRight: 0, dragRegion: true });
	expect(writes).toHaveLength(3);

	writer.update({ insetLeft: 2, insetRight: 3 });
	expect(writes.slice(-3)).toEqual([
		["--window-chrome-inset-left", "2px"],
		["--window-chrome-inset-right", "3px"],
		["--window-chrome-drag-region", "no-drag"],
	]);
});

test("window chrome geometry publishes on dom-ready and only changed resize geometry", () => {
	const registrations: string[] = [];
	let resizeListener: (() => void) | undefined;
	let domReadyListener: (() => void) | undefined;
	const window = {
		on(name: "resize", listener: () => void) {
			registrations.push(name);
			resizeListener = listener;
		},
		webview: {
			on(name: "dom-ready", listener: () => void) {
				registrations.push(name);
				domReadyListener = listener;
			},
		},
	};
	let geometry = { insetLeft: 64, insetRight: 0 };
	const published: Array<{ insetLeft: number; insetRight: number }> = [];
	installWindowChromeGeometry(
		window,
		() => geometry,
		(next) => published.push(next),
	);
	expect(registrations).toEqual(["resize", "dom-ready"]);

	resizeListener?.();
	resizeListener?.();
	geometry = { insetLeft: 64, insetRight: 8 };
	resizeListener?.();
	domReadyListener?.();
	domReadyListener?.();
	expect(published).toEqual([
		{ insetLeft: 64, insetRight: 0 },
		{ insetLeft: 64, insetRight: 8 },
		{ insetLeft: 64, insetRight: 8 },
		{ insetLeft: 64, insetRight: 8 },
	]);
});

test("window chrome publishers send state on dom-ready and changed resize", () => {
	let resizeListener: (() => void) | undefined;
	let domReadyListener: (() => void) | undefined;
	const window = {
		on(name: "resize", listener: () => void) {
			expect(name).toBe("resize");
			resizeListener = listener;
		},
		webview: {
			on(name: "dom-ready", listener: () => void) {
				expect(name).toBe("dom-ready");
				domReadyListener = listener;
			},
		},
	};
	let state = { maximized: false, fullScreen: false };
	const published: (typeof state)[] = [];
	installWindowChromePublisher(
		window,
		() => state,
		(next) => published.push(next),
		(a, b) => a.maximized === b.maximized && a.fullScreen === b.fullScreen,
	);
	domReadyListener?.();
	resizeListener?.();
	state = { maximized: true, fullScreen: false };
	resizeListener?.();
	expect(published).toEqual([
		{ maximized: false, fullScreen: false },
		{ maximized: true, fullScreen: false },
	]);
});

test("preload injection installs initial geometry and policies before bundled source", () => {
	const preload = injectInitialWindowChrome(
		"globalThis.seed = globalThis.__THINKRAIL_INITIAL_WINDOW_CHROME__;",
		{ insetLeft: 64, insetRight: 0, dragRegion: true, windowControls: true },
	);
	const context: { seed?: unknown } = {};
	runInNewContext(preload, context);
	expect(context.seed).toEqual({
		insetLeft: 64,
		insetRight: 0,
		dragRegion: true,
		windowControls: true,
	});
	expect(preload.indexOf(INITIAL_WINDOW_CHROME_GLOBAL)).toBeGreaterThanOrEqual(0);
});
