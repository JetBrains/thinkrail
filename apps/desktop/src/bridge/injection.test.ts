import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
	INITIAL_DESKTOP_PREFERENCES_GLOBAL,
	STABLE_PREFERENCES_GLOBAL,
} from "../preferenceAdapter";
import { INITIAL_WINDOW_CHROME_GLOBAL, NATIVE_WINDOW_CONTROLS_GLOBAL } from "../windowChrome";
import { type TauriWindowSeed, tauriInitializationScript } from "./injection";

const BRIDGE_GLOBALS = [
	"__THINKRAIL_NATIVE_SHORTCUTS__",
	"__THINKRAIL_NATIVE_UPDATES__",
	"__THINKRAIL_NATIVE_PAGE_ZOOM__",
	"__THINKRAIL_NATIVE_DEEP_LINKS__",
	"__THINKRAIL_NATIVE_NOTIFICATIONS__",
	"__THINKRAIL_NATIVE_MENU__",
	STABLE_PREFERENCES_GLOBAL,
] as const;

const BACKEND_COMMANDS = [
	"get_update_state",
	"check_for_updates",
	"download_update",
	"restart_to_update",
	"dismiss_install_result",
	"get_window_state",
	"minimize_window",
	"toggle_maximize_window",
	"close_window",
	"quit_app",
	"show_notification",
	"route_changed",
	"preference_write",
	"preference_remove",
	"title_bar_double_click",
	"page_zoom_requested",
	"page_zoom_gesture_requested",
	"menu_labels_changed",
] as const;

interface InvokeCall {
	cmd: string;
	args: unknown;
}

interface Sandbox {
	readonly calls: InvokeCall[];
	readonly emit: (event: string, payload: unknown) => void;
	readonly css: Record<string, string>;
	readonly attributes: Record<string, string>;
	readonly assignedUrls: string[];
	readonly context: Record<string, unknown>;
}

function createSandbox(): Sandbox {
	const calls: InvokeCall[] = [];
	const handlers = new Map<string, Array<(envelope: { payload: unknown }) => void>>();
	const css: Record<string, string> = {};
	const attributes: Record<string, string> = {};
	const assignedUrls: string[] = [];
	const windowListeners = new Map<string, Array<(...args: unknown[]) => void>>();
	const context: Record<string, unknown> = {
		document: {
			documentElement: {
				style: {
					setProperty: (key: string, value: string): void => {
						css[key] = value;
					},
				},
				setAttribute: (key: string, value: string): void => {
					attributes[key] = value;
				},
			},
			hasFocus: (): boolean => false,
			addEventListener: (): void => undefined,
		},
		history: {
			replaceState: (): void => undefined,
			pushState: (): void => undefined,
		},
		navigator: { platform: "Win32" },
		getComputedStyle: (): { getPropertyValue: () => string } => ({
			getPropertyValue: () => "",
		}),
		queueMicrotask: (task: () => void): void => {
			task();
		},
		setTimeout: (): number => 0,
		URL,
		__TAURI__: {
			core: {
				invoke: async (cmd: string, args: unknown): Promise<null> => {
					calls.push({ cmd, args });
					return null;
				},
			},
			event: {
				listen: async (
					event: string,
					handler: (envelope: { payload: unknown }) => void,
				): Promise<() => void> => {
					const existing = handlers.get(event) ?? [];
					existing.push(handler);
					handlers.set(event, existing);
					return () => undefined;
				},
			},
		},
	};
	const addEventListener = (name: string, listener: (...args: unknown[]) => void): void => {
		const existing = windowListeners.get(name) ?? [];
		existing.push(listener);
		windowListeners.set(name, existing);
	};
	context.addEventListener = addEventListener;
	context.window = {
		location: {
			hash: "#/view/some-workspace",
			origin: "http://127.0.0.1:7",
			assign: (url: string): void => {
				assignedUrls.push(url);
			},
		},
		addEventListener,
		open: (): null => null,
	};
	return {
		calls,
		emit: (event: string, payload: unknown) => {
			for (const handler of handlers.get(event) ?? []) handler({ payload });
		},
		css,
		attributes,
		assignedUrls,
		context,
	};
}

function runSeed(seed: TauriWindowSeed): Sandbox {
	const sandbox = createSandbox();
	runInNewContext(tauriInitializationScript(seed), sandbox.context);
	return sandbox;
}

const WINDOWS_SEED: TauriWindowSeed = {
	windowChrome: { insetLeft: 0, insetRight: 138, dragRegion: true, windowControls: true },
	preferences: { theme: "dark" },
};

describe("tauriInitializationScript", () => {
	test("embeds the seed globals, CSS writer, and bridge source", () => {
		const script = tauriInitializationScript(WINDOWS_SEED);
		expect(script).toContain(INITIAL_WINDOW_CHROME_GLOBAL);
		expect(script).toContain(INITIAL_DESKTOP_PREFERENCES_GLOBAL);
		for (const name of BRIDGE_GLOBALS) expect(script).toContain(name);
		expect(script).toContain(NATIVE_WINDOW_CONTROLS_GLOBAL);
		expect(script).toContain("--window-chrome-inset-left");
		expect(script).toContain("--window-chrome-inset-right");
		expect(script).toContain("data-window-chrome-drag-region");
		for (const command of BACKEND_COMMANDS) expect(script).toContain(`"${command}"`);
		expect(script).not.toContain("</script>");
	});

	test("installs frozen non-enumerable globals the web shape-guards accept", () => {
		const sandbox = runSeed(WINDOWS_SEED);
		for (const name of [...BRIDGE_GLOBALS, NATIVE_WINDOW_CONTROLS_GLOBAL]) {
			const descriptor = Object.getOwnPropertyDescriptor(sandbox.context, name);
			expect(descriptor, name).toBeDefined();
			expect(descriptor?.enumerable, name).toBe(false);
			expect(descriptor?.configurable, name).toBe(false);
			expect(Object.isFrozen(descriptor?.value), name).toBe(true);
		}
		// Seeds are consumed like takePreloadGlobal.
		expect(sandbox.context[INITIAL_WINDOW_CHROME_GLOBAL]).toBeUndefined();
		expect(sandbox.context[INITIAL_DESKTOP_PREFERENCES_GLOBAL]).toBeUndefined();
	});

	test("writes the window-chrome vars for first paint", () => {
		const sandbox = runSeed(WINDOWS_SEED);
		expect(sandbox.css["--window-chrome-inset-left"]).toBe("0px");
		expect(sandbox.css["--window-chrome-inset-right"]).toBe("138px");
		expect(sandbox.attributes["data-window-chrome-drag-region"]).toBe("drag");
	});

	test("omits the window-controls bridge when the seed disables it", () => {
		const sandbox = runSeed({
			windowChrome: { insetLeft: 64, insetRight: 0, dragRegion: true, windowControls: false },
			preferences: {},
		});
		expect(
			Object.getOwnPropertyDescriptor(sandbox.context, NATIVE_WINDOW_CONTROLS_GLOBAL),
		).toBeUndefined();
		for (const name of BRIDGE_GLOBALS) {
			expect(Object.getOwnPropertyDescriptor(sandbox.context, name), name).toBeDefined();
		}
	});

	test("routes backend events, preferences, and route changes over invoke", async () => {
		const sandbox = runSeed(WINDOWS_SEED);
		const updates = sandbox.context.__THINKRAIL_NATIVE_UPDATES__ as {
			subscribe: (listener: (state: { revision: number }) => void) => () => void;
			checkForUpdates: () => Promise<void>;
		};
		const seen: Array<{ revision: number }> = [];
		const unsubscribe = updates.subscribe((state) => seen.push(state));
		sandbox.emit("updateStateChanged", { revision: 3 });
		expect(seen).toEqual([{ revision: 3 }]);
		unsubscribe();
		sandbox.emit("updateStateChanged", { revision: 4 });
		expect(seen).toEqual([{ revision: 3 }]);
		await updates.checkForUpdates();
		expect(sandbox.calls.some((call) => call.cmd === "check_for_updates")).toBe(true);

		const preferences = sandbox.context[STABLE_PREFERENCES_GLOBAL] as {
			getItem: (key: string) => string | null;
			setItem: (key: string, value: string) => void;
		};
		expect(preferences.getItem("theme")).toBe("dark");
		expect(preferences.getItem("unknown")).toBeNull();
		preferences.setItem("theme", "light");
		expect(
			sandbox.calls.some(
				(call) =>
					call.cmd === "preference_write" &&
					(call.args as Record<string, string>).value === "light",
			),
		).toBe(true);

		// queueMicrotask(sendRoute) reports the current hash on startup.
		expect(
			sandbox.calls.some(
				(call) =>
					call.cmd === "route_changed" &&
					(call.args as Record<string, string>).hash === "#/view/some-workspace",
			),
		).toBe(true);

		const shortcuts = sandbox.context.__THINKRAIL_NATIVE_SHORTCUTS__ as {
			quit: () => Promise<unknown>;
		};
		await shortcuts.quit();
		expect(sandbox.calls.some((call) => call.cmd === "quit_app")).toBe(true);
	});
});
