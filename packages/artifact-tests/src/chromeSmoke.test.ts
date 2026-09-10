import { expect, test } from "bun:test";
import {
	type ChromeSample,
	chromeArguments,
	chromeEnvironment,
	closeGeometry,
	measuredState,
} from "../chromeSmoke";

function sample(): ChromeSample {
	return {
		sequence: 1,
		ready: {
			origin: "http://127.0.0.1:1234",
			runtimeDir: "runtime",
			pid: 20,
			launcherPid: 10,
			windowUrl: "http://127.0.0.1:1234/#/v1",
			mode: "ui",
		},
		chrome: {
			pid: 20,
			hwnd: 123,
			documentCount: 1,
			frame: { x: 20, y: 20, width: 800, height: 600 },
			fullScreen: false,
			maximized: false,
			minimized: false,
			geometry: { insetLeft: 0, insetRight: 138 },
		},
		native: {
			hwnd: 123,
			pid: 20,
			dpi: 96,
			visible: true,
			fullScreen: false,
			maximized: false,
			minimized: false,
			window: { left: 20, top: 20, right: 820, bottom: 620 },
			client: { left: 28, top: 28, right: 812, bottom: 612 },
			monitor: { left: 0, top: 0, right: 1920, bottom: 1080 },
		},
	};
}

test("rejects unsupported targets and ambiguous arguments before side effects", () => {
	expect(() => chromeArguments([], "linux", "x64")).toThrow("win32-x64");
	expect(() => chromeArguments([], "win32", "arm64")).toThrow("win32-x64");
	for (const args of [
		["--launcher"],
		["extra.exe"],
		["--evidence-dir", "--launcher"],
		["--launcher", "a", "--launcher", "b"],
	]) {
		expect(() => chromeArguments(args, "win32", "x64")).toThrow("Usage:");
	}
	expect(chromeArguments([], "win32", "x64")).toEqual({});
	expect(chromeArguments(["--evidence-dir", "evidence"], "win32", "x64").evidenceDir).toBeDefined();
});

test("allows only OS essentials, isolated paths and live chrome seams; no credentials or user tools", () => {
	const env = chromeEnvironment("C:\\isolated", {
		sYsTeMrOoT: "C:\\Windows",
		PSModulePath: "real-modules",
		Home: "real-home",
		UserProfile: "real-profile",
		LocalAppData: "real-local",
		Path: "user-tools",
		OPENAI_API_KEY: "real-secret",
		CODEX_HOME: "real-auth",
		SSH_AUTH_SOCK: "real-agent",
		thinkrail_desktop_e2e_host: "1",
		THINKRAIL_DESKTOP_NAVIGATION_PROBE_FILE: "real-navigation",
		WEBVIEW2_USER_DATA_FOLDER: "real-webview",
		NODE_OPTIONS: "--require real-code",
	});
	expect(env.HOME).toBe(env.USERPROFILE);
	expect(env.SystemRoot).toBe("C:\\Windows");
	expect(Object.keys(env).filter((key) => key.toLowerCase() === "systemroot")).toEqual([
		"SystemRoot",
	]);
	for (const key of [
		"HOME",
		"USERPROFILE",
		"LOCALAPPDATA",
		"APPDATA",
		"THINKRAIL_DATA_DIR",
		"PI_CODING_AGENT_DIR",
		"XDG_CACHE_HOME",
		"THINKRAIL_DESKTOP_USER_DATA",
		"WEBVIEW2_USER_DATA_FOLDER",
	]) {
		expect(env[key]).toStartWith("C:\\isolated");
	}
	expect(JSON.stringify(env)).not.toMatch(/real-|user-tools/);
	expect(Object.keys(env).map((key) => key.toLowerCase())).not.toContain(
		"thinkrail_desktop_e2e_host",
	);
	expect(env.THINKRAIL_DESKTOP_HIDDEN).toBe("0");
	expect(env.PI_OFFLINE).toBe("1");
	expect(env.THINKRAIL_NO_ANALYTICS).toBe("1");
	expect(env.ELECTROBUN_CONSOLE).toBe("1");
	expect(() => chromeEnvironment("C:\\isolated", {})).toThrow("SystemRoot");
});

test("never passes null, invalid, zero restored or out-of-client geometry", () => {
	const value = sample();
	expect(measuredState(value, "restored", 1)).toBe(true);
	for (const geometry of [
		null,
		{ insetLeft: 0, insetRight: 0 },
		{ insetLeft: -1, insetRight: 100 },
		{ insetLeft: 0, insetRight: Number.NaN },
		{ insetLeft: 0, insetRight: 800 },
	]) {
		value.chrome.geometry = geometry;
		expect(measuredState(value, "restored", 1)).toBe(false);
	}
	value.native.dpi = 192;
	value.chrome.geometry = { insetLeft: 0, insetRight: 400 };
	expect(measuredState(value, "restored", 1)).toBe(false);
});

test("compares both inset sides when a native state returns", () => {
	const baseline = { insetLeft: 0, insetRight: 138 };
	expect(closeGeometry(baseline, { insetLeft: 1.5, insetRight: 136 })).toBe(true);
	expect(closeGeometry(baseline, { insetLeft: 3, insetRight: 138 })).toBe(false);
	expect(closeGeometry(baseline, { insetLeft: 0, insetRight: 135 })).toBe(false);
});

test("rejects mismatched identity and absent frame measurements", () => {
	const value = sample();
	value.native.pid += 1;
	expect(measuredState(value, "restored", 1)).toBe(false);
	value.native.pid = value.chrome.pid;
	value.native.hwnd += 1;
	expect(measuredState(value, "restored", 1)).toBe(false);
	value.native.hwnd = value.chrome.hwnd;
	Reflect.deleteProperty(value.chrome.frame, "x");
	expect(measuredState(value, "restored", 1)).toBe(false);
	value.chrome.frame.x = 20;
	Reflect.deleteProperty(value.native.window, "left");
	expect(measuredState(value, "restored", 1)).toBe(false);
});

test("does not turn diagnostic title rectangles or synthetic hit codes into acceptance", () => {
	const value = sample();
	const native = {
		...value.native,
		diagnostics: {
			titlebarInfoEx: { raw: { rcTitleBar: { left: 20, top: 40, right: 820, bottom: 20 } } },
			syntheticEdgeHits: [{ edge: "top", delivered: false, code: null }],
		},
	};
	expect(measuredState({ ...value, native }, "restored", 1)).toBe(true);
	expect(
		native.diagnostics.titlebarInfoEx.raw.rcTitleBar.bottom -
			native.diagnostics.titlebarInfoEx.raw.rcTitleBar.top,
	).toBe(-20);
	expect(native.diagnostics.syntheticEdgeHits[0]?.code).toBeNull();
});

test("requires independent native state, real monitor bounds and a new document for reload", () => {
	const value = sample();
	value.chrome.maximized = true;
	expect(measuredState(value, "maximized", 1)).toBe(false);
	value.native.maximized = true;
	expect(measuredState(value, "maximized", 1)).toBe(true);
	value.chrome.maximized = value.native.maximized = false;
	value.chrome.fullScreen = value.native.fullScreen = true;
	value.chrome.geometry = { insetLeft: 0, insetRight: 0 };
	expect(measuredState(value, "fullscreen", 1)).toBe(false);
	value.native.window = value.native.monitor;
	expect(measuredState(value, "fullscreen", 1)).toBe(true);
	expect(measuredState(value, "fullscreen", 2)).toBe(false);
	value.chrome.documentCount = 2;
	expect(measuredState(value, "fullscreen", 2)).toBe(true);
	value.chrome.maximized = value.native.maximized = true;
	expect(measuredState(value, "fullscreen", 2)).toBe(true);
	value.native.maximized = false;
	expect(measuredState(value, "fullscreen", 2)).toBe(false);
	value.native.maximized = true;
	value.native.minimized = true;
	expect(measuredState(value, "fullscreen", 2)).toBe(false);
});
