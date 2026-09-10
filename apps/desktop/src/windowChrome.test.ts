import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
	createWindowChromeStyleWriter,
	desktopWindowChrome,
	INITIAL_WINDOW_CHROME_GLOBAL,
	injectInitialWindowChrome,
	installWindowChromeGeometry,
	MAX_WINDOW_CHROME_INSET,
	readWindowChromeGeometry,
	type WindowChromeGeometry,
	windowChromeGeometry,
} from "./windowChrome";

test("macOS keeps traffic lights within the shared 40px header", () => {
	expect(desktopWindowChrome("darwin")).toEqual({
		titleBarStyle: "hiddenInset",
		trafficLightOffset: { x: 0, y: 4 },
		geometry: { insetLeft: 64, insetRight: 0 },
		dragRegion: true,
	});
});

test("other platforms retain native decorations until their adapters are qualified", () => {
	for (const platform of ["win32", "linux", "freebsd"] as const) {
		expect(desktopWindowChrome(platform)).toEqual({
			titleBarStyle: "default",
			trafficLightOffset: null,
			geometry: { insetLeft: 0, insetRight: 0 },
			dragRegion: false,
		});
	}
});

test("only the isolated Windows probe opts into candidate native decoration policy", () => {
	expect(desktopWindowChrome("win32", true)).toEqual({
		titleBarStyle: "hiddenInset",
		trafficLightOffset: null,
		geometry: { insetLeft: 0, insetRight: 0 },
		dragRegion: true,
	});
	expect(desktopWindowChrome("linux", true)).toEqual(desktopWindowChrome("linux"));
	expect(desktopWindowChrome("darwin", true)).toEqual(desktopWindowChrome("darwin"));
});

test("fullscreen removes both safe areas and restores platform geometry", () => {
	const policy = {
		...desktopWindowChrome("darwin"),
		geometry: { insetLeft: 64, insetRight: 138 },
	};
	expect(windowChromeGeometry(policy, true)).toEqual({ insetLeft: 0, insetRight: 0 });
	expect(windowChromeGeometry(policy, false)).toEqual(policy.geometry);
});

test("native geometry accepts only bounded finite numbers and whitelists its fields", () => {
	for (const payload of [
		null,
		undefined,
		[],
		"64",
		{ insetLeft: 64 },
		{ insetLeft: -1, insetRight: 0 },
		{ insetLeft: 0, insetRight: -1 },
		{ insetLeft: Number.NaN, insetRight: 0 },
		{ insetLeft: 0, insetRight: Number.POSITIVE_INFINITY },
		{ insetLeft: MAX_WINDOW_CHROME_INSET + 1, insetRight: 0 },
		{ insetLeft: 0, insetRight: MAX_WINDOW_CHROME_INSET + 1 },
		{ insetLeft: "64", insetRight: 0 },
	]) {
		expect(readWindowChromeGeometry(payload)).toBeNull();
	}
	expect(
		readWindowChromeGeometry({ insetLeft: 6.5, insetRight: MAX_WINDOW_CHROME_INSET, extra: true }),
	).toEqual({ insetLeft: 6.5, insetRight: MAX_WINDOW_CHROME_INSET });
});

test("the latest geometry wins when native updates precede document readiness", () => {
	const properties = new Map<string, string>();
	const style = {
		setProperty: (name: string, value: string | null) => properties.set(name, value ?? ""),
	};
	let ready = false;
	const writer = createWindowChromeStyleWriter(() => (ready ? style : null));
	writer.update({ insetLeft: 64, insetRight: 0, dragRegion: true });
	writer.update({ insetLeft: 0, insetRight: 0 });
	expect(properties.size).toBe(0);
	ready = true;
	writer.flush();
	expect(Object.fromEntries(properties)).toEqual({
		"--window-chrome-inset-left": "0px",
		"--window-chrome-inset-right": "0px",
		"--window-chrome-drag-region": "drag",
	});
	writer.update({ insetLeft: 12.5, insetRight: 96 });
	writer.update({ insetLeft: -1, insetRight: 0, dragRegion: false });
	writer.flush();
	expect(Object.fromEntries(properties)).toEqual({
		"--window-chrome-inset-left": "12.5px",
		"--window-chrome-inset-right": "96px",
		"--window-chrome-drag-region": "drag",
	});
});

test("every new document receives current fullscreen geometry without another resize", () => {
	const listeners = new Map<string, () => void>();
	let fullScreen = false;
	const published: WindowChromeGeometry[] = [];
	installWindowChromeGeometry(
		{
			on: (name, listener) => listeners.set(name, listener),
			webview: { on: (name, listener) => listeners.set(name, listener) },
		},
		() => windowChromeGeometry(desktopWindowChrome("darwin"), fullScreen),
		(geometry) => published.push(geometry),
	);
	expect([...listeners.keys()]).toEqual(["resize", "dom-ready"]);
	listeners.get("dom-ready")?.();
	fullScreen = true;
	listeners.get("resize")?.();
	listeners.get("dom-ready")?.();
	fullScreen = false;
	listeners.get("resize")?.();
	expect(published).toEqual([
		{ insetLeft: 64, insetRight: 0 },
		{ insetLeft: 0, insetRight: 0 },
		{ insetLeft: 0, insetRight: 0 },
		{ insetLeft: 64, insetRight: 0 },
	]);
});

test("native geometry is remeasured on every document without publishing unavailable values", () => {
	const listeners = new Map<string, () => void>();
	const published: WindowChromeGeometry[] = [];
	let measured: WindowChromeGeometry | null = null;
	installWindowChromeGeometry(
		{
			on: (name, listener) => listeners.set(name, listener),
			webview: { on: (name, listener) => listeners.set(name, listener) },
		},
		() => measured,
		(geometry) => published.push(geometry),
	);
	listeners.get("dom-ready")?.();
	measured = { insetLeft: 0, insetRight: 141.5 };
	listeners.get("dom-ready")?.();
	measured = { insetLeft: 2.5, insetRight: 139 };
	listeners.get("resize")?.();
	expect(published).toEqual([
		{ insetLeft: 0, insetRight: 141.5 },
		{ insetLeft: 2.5, insetRight: 139 },
	]);
});

test("native appearance is advertised only in an explicitly enabled preload", () => {
	const context: Record<string, unknown> = {};
	runInNewContext(
		injectInitialWindowChrome(
			`globalThis.seed = globalThis.${INITIAL_WINDOW_CHROME_GLOBAL};`,
			{ insetLeft: 0, insetRight: 0 },
			true,
			true,
		),
		context,
	);
	expect(context.seed).toEqual({
		insetLeft: 0,
		insetRight: 0,
		nativeAppearance: true,
		dragRegion: true,
	});
});

test("preload geometry exists before bundled application code runs", () => {
	const context: Record<string, unknown> = {};
	runInNewContext(
		injectInitialWindowChrome(`globalThis.seed = globalThis.${INITIAL_WINDOW_CHROME_GLOBAL};`, {
			insetLeft: 64,
			insetRight: 0,
		}),
		context,
	);
	expect(context.seed).toEqual({
		insetLeft: 64,
		insetRight: 0,
		nativeAppearance: false,
		dragRegion: false,
	});
	expect(Object.getOwnPropertyDescriptor(context, INITIAL_WINDOW_CHROME_GLOBAL)).toMatchObject({
		enumerable: false,
		writable: false,
		configurable: true,
	});
});
