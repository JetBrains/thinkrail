import { expect, test } from "bun:test";
import {
	desktopWindowChrome,
	INITIAL_WINDOW_CHROME_GLOBAL,
	injectInitialWindowChrome,
	MAX_WINDOW_CHROME_INSET,
	readWindowChromeGeometry,
	windowChromeCssDeclarations,
	windowChromeGeometry,
} from "./windowChrome";

test("macOS hides the native strip, keeps the traffic lights centred in the 40px topbar, and reserves their zone", () => {
	expect(desktopWindowChrome("darwin")).toEqual({
		titleBarStyle: "hiddenInset",
		trafficLightOffset: { x: 0, y: 4 },
		geometry: { insetLeft: 64, insetRight: 0 },
	});
});

test("Windows and Linux keep the default native chrome and publish no inset", () => {
	for (const platform of ["win32", "linux", "freebsd"] as const) {
		expect(desktopWindowChrome(platform)).toEqual({
			titleBarStyle: "default",
			trafficLightOffset: null,
			geometry: { insetLeft: 0, insetRight: 0 },
		});
	}
});

test("native fullscreen collapses the left inset and restores it afterwards", () => {
	const policy = desktopWindowChrome("darwin");
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

test("geometry maps onto exactly the two published CSS custom properties", () => {
	expect(windowChromeCssDeclarations({ insetLeft: 64, insetRight: 0 })).toEqual([
		["--window-chrome-inset-left", "64px"],
		["--window-chrome-inset-right", "0px"],
	]);
});

test("preload injection installs the initial geometry before the bundled source", () => {
	const preload = injectInitialWindowChrome("globalThis.preloadStarted = true;", {
		insetLeft: 64,
		insetRight: 0,
	});
	expect(preload.indexOf(INITIAL_WINDOW_CHROME_GLOBAL)).toBeGreaterThanOrEqual(0);
	expect(preload.indexOf(INITIAL_WINDOW_CHROME_GLOBAL)).toBeLessThan(
		preload.indexOf("globalThis.preloadStarted"),
	);
	expect(preload).toContain('\\"insetLeft\\":64');
});
