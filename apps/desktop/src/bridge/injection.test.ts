import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { WORKSPACE_VIEW_ROUTE } from "@thinkrail/contracts";
import {
	INITIAL_DESKTOP_PREFERENCES_GLOBAL,
	MAX_DESKTOP_PREFERENCE_KEY_LENGTH,
	MAX_DESKTOP_PREFERENCE_VALUE_LENGTH,
	STABLE_PREFERENCES_GLOBAL,
} from "../preferenceAdapter";
import { ELECTROBUN_APP_REGION_PROPERTY } from "../titleBarDoubleClick";
import {
	INITIAL_WINDOW_CHROME_GLOBAL,
	MAX_WINDOW_CHROME_INSET,
	NATIVE_WINDOW_CONTROLS_GLOBAL,
} from "../windowChrome";
import { type TauriWindowSeed, tauriBootstrapSource, tauriInitializationScript } from "./injection";

/**
 * Every bridge global with the methods the web client's shape-guards require
 * (`getNativeShortcutsBridge`, `useUpdates`, `useNativeWindowControls`, … in
 * `apps/web`). A renamed or missing method here means the web client silently
 * treats the desktop as a plain browser.
 */
const BRIDGE_SHAPES: Readonly<Record<string, readonly string[]>> = {
	__THINKRAIL_NATIVE_SHORTCUTS__: ["subscribeQuitHint", "subscribeCommand", "quit"],
	__THINKRAIL_NATIVE_UPDATES__: [
		"getState",
		"checkForUpdates",
		"downloadUpdate",
		"restartToUpdate",
		"dismissInstallResult",
		"subscribe",
	],
	__THINKRAIL_NATIVE_LSP__: ["detect", "restart", "openUserConfig"],
	__THINKRAIL_NATIVE_PAGE_ZOOM__: ["request"],
	__THINKRAIL_NATIVE_DEEP_LINKS__: ["subscribe"],
	__THINKRAIL_NATIVE_NOTIFICATIONS__: ["show", "isWindowFocused"],
	__THINKRAIL_NATIVE_MENU__: ["setLabels"],
	[STABLE_PREFERENCES_GLOBAL]: ["getItem", "setItem", "removeItem"],
};
const WINDOW_CONTROLS_SHAPE = ["getState", "minimize", "toggleMaximize", "close", "subscribe"];

const SRC_TAURI = join(import.meta.dir, "..", "..", "src-tauri");

interface InvokeCall {
	cmd: string;
	args: unknown;
}

type Listener = (event: Record<string, unknown>) => void;

interface Sandbox {
	readonly calls: InvokeCall[];
	readonly emit: (event: string, payload: unknown) => void;
	readonly dispatch: (name: string, event: Record<string, unknown>) => void;
	readonly css: Record<string, string>;
	readonly attributes: Record<string, string>;
	readonly assignedUrls: string[];
	readonly context: Record<string, unknown>;
	/** Let the `listen()` promises (and what chains on them) settle. */
	readonly settle: () => Promise<void>;
}

function createSandbox(options: { dragRegion?: string } = {}): Sandbox {
	const calls: InvokeCall[] = [];
	const handlers = new Map<string, Array<(envelope: { payload: unknown }) => void>>();
	const css: Record<string, string> = {};
	const attributes: Record<string, string> = {};
	const assignedUrls: string[] = [];
	const windowListeners = new Map<string, Listener[]>();
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
		getComputedStyle: (): { getPropertyValue: (name: string) => string } => ({
			getPropertyValue: (name) =>
				name === ELECTROBUN_APP_REGION_PROPERTY ? (options.dragRegion ?? "") : "",
		}),
		queueMicrotask: (task: () => void): void => {
			task();
		},
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
	const addEventListener = (name: string, listener: Listener): void => {
		const existing = windowListeners.get(name) ?? [];
		existing.push(listener);
		windowListeners.set(name, existing);
	};
	context.addEventListener = addEventListener;
	context.window = {
		location: {
			hash: "#/v1/chat",
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
		emit: (event, payload) => {
			for (const handler of handlers.get(event) ?? []) handler({ payload });
		},
		dispatch: (name, event) => {
			for (const listener of windowListeners.get(name) ?? []) listener(event);
		},
		css,
		attributes,
		assignedUrls,
		context,
		settle: async () => {
			for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
		},
	};
}

function runSeed(seed: TauriWindowSeed, options?: { dragRegion?: string }): Sandbox {
	const sandbox = createSandbox(options);
	runInNewContext(tauriInitializationScript(seed), sandbox.context);
	return sandbox;
}

const WINDOWS_SEED: TauriWindowSeed = {
	windowChrome: { insetLeft: 0, insetRight: 138, dragRegion: true, windowControls: true },
	preferences: { theme: "dark" },
};

function commandsCalledByBootstrap(): string[] {
	const names = new Set<string>();
	for (const match of tauriBootstrapSource().matchAll(/\b(?:invoke|fire)\("([a-z_]+)"/g)) {
		if (match[1]) names.add(match[1]);
	}
	return [...names].sort();
}

function element(href?: string): Record<string, unknown> {
	const node: Record<string, unknown> = { nodeType: 1 };
	node.closest = () => (href === undefined ? null : { href, hasAttribute: () => false });
	return node;
}

describe("tauri bridge bootstrap", () => {
	test("mirrors the constants it shares with the Electrobun preload", () => {
		const source = tauriBootstrapSource();
		const constants: Record<string, string | number> = {
			CHROME_GLOBAL: INITIAL_WINDOW_CHROME_GLOBAL,
			PREFS_GLOBAL: INITIAL_DESKTOP_PREFERENCES_GLOBAL,
			ROUTE_PREFIX: WORKSPACE_VIEW_ROUTE,
			MAX_INSET: MAX_WINDOW_CHROME_INSET,
			MAX_PREF_KEY: MAX_DESKTOP_PREFERENCE_KEY_LENGTH,
			MAX_PREF_VALUE: MAX_DESKTOP_PREFERENCE_VALUE_LENGTH,
			TITLE_BAR_REGION_PROPERTY: ELECTROBUN_APP_REGION_PROPERTY,
		};
		for (const [name, value] of Object.entries(constants)) {
			expect(source).toContain(`const ${name} = ${JSON.stringify(value)};`);
		}
		for (const name of [...Object.keys(BRIDGE_SHAPES), NATIVE_WINDOW_CONTROLS_GLOBAL]) {
			expect(source).toContain(`"${name}"`);
		}
		expect(source).not.toContain("</script>");
	});

	test("the Rust shell embeds this source and writes the same seed globals", () => {
		const rust = readFileSync(join(SRC_TAURI, "src", "bridge.rs"), "utf8");
		expect(rust).toContain('include_str!("../../src/bridge/tauri-bootstrap.js")');
		expect(rust).toContain(`"${INITIAL_WINDOW_CHROME_GLOBAL}"`);
		expect(rust).toContain(`"${INITIAL_DESKTOP_PREFERENCES_GLOBAL}"`);
	});

	test("every command the bootstrap calls is registered and granted to the sidecar origin", () => {
		const commands = commandsCalledByBootstrap();
		expect(commands.length).toBeGreaterThan(15);
		const granted = readFileSync(join(SRC_TAURI, "permissions", "bridge.toml"), "utf8");
		const handler = readFileSync(join(SRC_TAURI, "src", "main.rs"), "utf8");
		for (const command of commands) {
			expect(granted, command).toContain(`"${command}"`);
			expect(handler, command).toContain(`::${command},`);
		}
	});

	test("installs frozen non-enumerable globals with the shapes the web guards check", () => {
		const sandbox = runSeed(WINDOWS_SEED);
		const shapes = { ...BRIDGE_SHAPES, [NATIVE_WINDOW_CONTROLS_GLOBAL]: WINDOW_CONTROLS_SHAPE };
		for (const [name, methods] of Object.entries(shapes)) {
			const descriptor = Object.getOwnPropertyDescriptor(sandbox.context, name);
			expect(descriptor, name).toBeDefined();
			expect(descriptor?.enumerable, name).toBe(false);
			expect(descriptor?.configurable, name).toBe(false);
			expect(descriptor?.writable, name).toBe(false);
			expect(Object.isFrozen(descriptor?.value), name).toBe(true);
			expect(Object.keys(descriptor?.value as object).sort(), name).toEqual([...methods].sort());
			for (const method of methods) {
				expect(typeof Reflect.get(descriptor?.value as object, method), `${name}.${method}`).toBe(
					"function",
				);
			}
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
		for (const name of Object.keys(BRIDGE_SHAPES)) {
			expect(Object.getOwnPropertyDescriptor(sandbox.context, name), name).toBeDefined();
		}
	});

	test("routes backend events, preferences, and route changes over invoke", async () => {
		const sandbox = runSeed(WINDOWS_SEED);
		await sandbox.settle();
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
			removeItem: (key: string) => void;
		};
		expect(preferences.getItem("theme")).toBe("dark");
		expect(preferences.getItem("unknown")).toBeNull();
		preferences.setItem("theme", "light");
		expect(preferences.getItem("theme")).toBe("light");
		expect(sandbox.calls).toContainEqual({
			cmd: "preference_write",
			args: { key: "theme", value: "light" },
		});
		preferences.removeItem("theme");
		expect(preferences.getItem("theme")).toBeNull();
		expect(sandbox.calls).toContainEqual({ cmd: "preference_remove", args: { key: "theme" } });

		// queueMicrotask(sendRoute) reports the current hash on startup.
		expect(sandbox.calls).toContainEqual({ cmd: "route_changed", args: { hash: "#/v1/chat" } });

		const shortcuts = sandbox.context.__THINKRAIL_NATIVE_SHORTCUTS__ as {
			quit: () => Promise<unknown>;
		};
		await shortcuts.quit();
		expect(sandbox.calls.some((call) => call.cmd === "quit_app")).toBe(true);
	});

	test("reports deep-link readiness only once its listener is registered", async () => {
		const sandbox = runSeed(WINDOWS_SEED);
		// `listen()` has not resolved yet: the shell must keep buffering.
		expect(sandbox.calls.some((call) => call.cmd === "deep_link_ready")).toBe(false);
		await sandbox.settle();
		expect(sandbox.calls.filter((call) => call.cmd === "deep_link_ready")).toHaveLength(1);

		// Links that arrive before the web client subscribes wait for it.
		sandbox.emit("openFile", { file: "/a.md", line: 1 });
		const deepLinks = sandbox.context.__THINKRAIL_NATIVE_DEEP_LINKS__ as {
			subscribe: (listener: (request: { file: string }) => void) => () => void;
		};
		const opened: string[] = [];
		deepLinks.subscribe((request) => opened.push(request.file));
		expect(opened).toEqual(["/a.md"]);
		sandbox.emit("openFile", { file: "/b.md", line: 2 });
		expect(opened).toEqual(["/a.md", "/b.md"]);
	});

	test("starts a window move from the title bar and leaves other presses alone", () => {
		const press = { button: 0, detail: 1, defaultPrevented: false, target: element() };
		const outside = runSeed(WINDOWS_SEED, { dragRegion: "no-drag" });
		outside.dispatch("mousedown", press);
		outside.dispatch("dblclick", press);
		expect(outside.calls.some((call) => call.cmd === "start_window_drag")).toBe(false);
		expect(outside.calls.some((call) => call.cmd === "title_bar_double_click")).toBe(false);

		const titleBar = runSeed(WINDOWS_SEED, { dragRegion: " Drag " });
		titleBar.dispatch("mousedown", { ...press, button: 2 });
		// The second press of a double-click belongs to `dblclick`, not a move.
		titleBar.dispatch("mousedown", { ...press, detail: 2 });
		expect(titleBar.calls.some((call) => call.cmd === "start_window_drag")).toBe(false);
		titleBar.dispatch("mousedown", press);
		expect(titleBar.calls.filter((call) => call.cmd === "start_window_drag")).toHaveLength(1);
		titleBar.dispatch("dblclick", press);
		expect(titleBar.calls.filter((call) => call.cmd === "title_bar_double_click")).toHaveLength(1);
	});

	test("hands external links to the shell's navigation policy", () => {
		const sandbox = runSeed(WINDOWS_SEED);
		const click = (href: string): boolean => {
			let prevented = false;
			sandbox.dispatch("click", {
				button: 0,
				defaultPrevented: false,
				ctrlKey: false,
				metaKey: false,
				target: element(href),
				preventDefault: () => {
					prevented = true;
				},
			});
			return prevented;
		};
		// In-app routes stay with the web client.
		expect(click("http://127.0.0.1:7/#/v1/settings")).toBe(false);
		expect(click("javascript:alert(1)")).toBe(false);
		expect(sandbox.assignedUrls).toEqual([]);
		expect(click("https://example.com/docs")).toBe(true);
		expect(click("mailto:team@example.com")).toBe(true);
		expect(click(`http://127.0.0.1:7${WORKSPACE_VIEW_ROUTE}abc`)).toBe(true);
		expect(sandbox.assignedUrls).toEqual([
			"https://example.com/docs",
			"mailto:team@example.com",
			`http://127.0.0.1:7${WORKSPACE_VIEW_ROUTE}abc`,
		]);
		const open = (sandbox.context.window as { open: (url: string) => unknown }).open;
		expect(open("https://example.com/new")).toBeNull();
		expect(sandbox.assignedUrls.at(-1)).toBe("https://example.com/new");
	});

	test("does nothing but first-paint chrome when Tauri's API is missing", () => {
		const sandbox = createSandbox();
		delete sandbox.context.__TAURI__;
		runInNewContext(tauriInitializationScript(WINDOWS_SEED), sandbox.context);
		expect(sandbox.css["--window-chrome-inset-right"]).toBe("138px");
		for (const name of Object.keys(BRIDGE_SHAPES)) {
			expect(Object.getOwnPropertyDescriptor(sandbox.context, name), name).toBeUndefined();
		}
	});
});
