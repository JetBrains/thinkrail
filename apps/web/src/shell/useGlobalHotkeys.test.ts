import { describe, expect, test } from "bun:test";
import { type ResolvedKeybindings, resolveKeybindings } from "../keybindings";
import type { ShortcutPlatform } from "./shortcutCommands";
import { globalHotkeyCommand, routeHotkey } from "./useGlobalHotkeys";

const key = (
	code: string,
	overrides: Partial<{
		key: string;
		ctrlKey: boolean;
		metaKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
		isComposing: boolean;
	}> = {},
) => ({
	code,
	key: "",
	ctrlKey: true,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	isComposing: false,
	keyCode: 0,
	...overrides,
});

const noop = () => {};

const route = (
	event: Parameters<typeof globalHotkeyCommand>[0],
	actions: Parameters<typeof globalHotkeyCommand>[1],
	modalOpen: boolean,
	platform: string,
	inTerminal?: boolean,
	inEditorFind?: boolean,
) =>
	globalHotkeyCommand(
		event,
		actions,
		modalOpen,
		resolveKeybindings({ platform }),
		inTerminal,
		inEditorFind,
	);

const all = {
	onProjects: noop,
	onWorkspace: noop,
	onBottom: noop,
	onNewWorkspace: noop,
	onSearch: noop,
};

const { onSearch: _search, ...withoutSearch } = all;
const { onNewWorkspace: _newWorkspace, ...withoutNewWorkspace } = all;

describe("global hotkey routing", () => {
	test("keeps the existing physical-key chords and adds Mod+Shift+J for bottom", () => {
		expect(route(key("KeyB"), all, false, "Linux")).toBe("view.toggleLeft");
		expect(route(key("KeyJ"), all, false, "Linux")).toBe("view.toggleRight");
		expect(route(key("KeyJ", { shiftKey: true }), all, false, "Linux")).toBe("view.toggleBottom");
		expect(
			route(key("KeyJ", { ctrlKey: false, metaKey: true, shiftKey: true }), all, false, "MacIntel"),
		).toBe("view.toggleBottom");
		expect(route(key("KeyK", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(route(key("KeyB", { altKey: true }), all, false, "Linux")).toBeNull();
	});

	test("routes Mod+K to search when available, suppressed behind modal", () => {
		expect(route(key("KeyK"), all, false, "Linux")).toBe("search.open");
		expect(route(key("KeyK", { ctrlKey: false, metaKey: true }), all, false, "MacIntel")).toBe(
			"search.open",
		);
		expect(route(key("KeyK"), all, true, "Linux")).toBeNull();
		expect(route(key("KeyK"), withoutSearch, false, "Linux")).toBeNull();
		expect(route(key("KeyK", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(route(key("KeyK", { altKey: true }), all, false, "Linux")).toBeNull();
	});

	test("routes Mod+N and the Mod+Alt+N alias to new-workspace, never with Shift, never when unavailable or behind a modal", () => {
		expect(route(key("KeyN"), all, false, "Linux")).toBe("workspace.new");
		expect(route(key("KeyN", { ctrlKey: false, metaKey: true }), all, false, "MacIntel")).toBe(
			"workspace.new",
		);
		expect(route(key("KeyN", { altKey: true }), all, false, "Linux")).toBe("workspace.new");
		expect(
			route(key("KeyN", { ctrlKey: false, metaKey: true, altKey: true }), all, false, "MacIntel"),
		).toBe("workspace.new");
		expect(route(key("KeyN", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(route(key("KeyN"), withoutNewWorkspace, false, "Linux")).toBeNull();
		expect(route(key("KeyN"), all, true, "Linux")).toBeNull();
		expect(route(key("KeyN", { metaKey: false }), all, false, "MacIntel")).toBeNull();
	});

	test("routes Mod+Shift+F to find-in-files only when available, never with Alt or behind a modal; plain Mod+F stays the browser's", () => {
		const withFind = { ...all, onFindInFiles: noop };
		expect(route(key("KeyF", { shiftKey: true }), withFind, false, "Linux")).toBe(
			"files.findInFiles",
		);
		expect(
			route(
				key("KeyF", { ctrlKey: false, metaKey: true, shiftKey: true }),
				withFind,
				false,
				"MacIntel",
			),
		).toBe("files.findInFiles");
		expect(route(key("KeyF", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(route(key("KeyF"), withFind, false, "Linux")).toBeNull();
		expect(
			route(key("KeyF", { shiftKey: true, altKey: true }), withFind, false, "Linux"),
		).toBeNull();
		expect(route(key("KeyF", { shiftKey: true }), withFind, true, "Linux")).toBeNull();
	});

	test("does not claim unavailable workspace commands or any panel chord behind a modal", () => {
		expect(route(key("KeyJ", { shiftKey: true }), { onProjects: noop }, false, "Linux")).toBeNull();
		expect(route(key("KeyB"), all, true, "Linux")).toBeNull();
		expect(route(key("KeyJ"), all, true, "Linux")).toBeNull();
		expect(route(key("KeyJ", { shiftKey: true }), all, true, "Linux")).toBeNull();
	});
});

describe("region and focus chords", () => {
	const focus = {
		...all,
		onNextRegion: noop,
		onPreviousRegion: noop,
		onComposer: noop,
		onFocusProjects: noop,
		onFocusGroup: noop,
		onTerminal: noop,
		onFiles: noop,
		onChanges: noop,
	};
	const plain = { ctrlKey: false };
	const command = { ctrlKey: false, metaKey: true };

	test("route F6, Shift+F6, Mod+L, Mod+0, Mod+1…9, Ctrl+` and Mod+Shift+E/G to their bindings", () => {
		for (const [platform, mod] of [
			["Linux", {}],
			["MacIntel", command],
		] as const) {
			expect(route(key("F6", plain), focus, false, platform)).toBe("region.next");
			expect(route(key("F6", { ...plain, shiftKey: true }), focus, false, platform)).toBe(
				"region.previous",
			);
			expect(route(key("KeyL", mod), focus, false, platform)).toBe("focus.composer");
			expect(route(key("Digit0", mod), focus, false, platform)).toBe("focus.projects");
			expect(route(key("Digit1", mod), focus, false, platform)).toBe("focus.group1");
			expect(route(key("Digit9", mod), focus, false, platform)).toBe("focus.group9");
			expect(route(key("Backquote"), focus, false, platform)).toBe("focus.terminal");
			expect(route(key("KeyE", { ...mod, shiftKey: true }), focus, false, platform)).toBe(
				"view.files",
			);
			expect(route(key("KeyG", { ...mod, shiftKey: true }), focus, false, platform)).toBe(
				"view.changes",
			);
		}
	});

	test("leave Ctrl+L to a focused terminal's shell, but take Cmd+L there on a Mac", () => {
		expect(route(key("KeyL"), focus, false, "Linux", true)).toBeNull();
		expect(route(key("KeyL"), focus, false, "Win32", true)).toBeNull();
		expect(route(key("KeyL", command), focus, false, "MacIntel", true)).toBe("focus.composer");
		expect(route(key("F6", plain), focus, false, "Linux", true)).toBe("region.next");
		expect(route(key("Backquote"), focus, false, "Linux", true)).toBe("focus.terminal");
	});

	test("leave Ctrl+F6 to the workbench and Numpad0 to page zoom", () => {
		expect(route(key("F6"), focus, false, "Linux")).toBeNull();
		expect(route(key("F6", { shiftKey: true }), focus, false, "Linux")).toBeNull();
		expect(route(key("Numpad0"), focus, false, "Linux")).toBeNull();
		expect(route(key("Digit0", { shiftKey: true }), focus, false, "Linux")).toBeNull();
	});

	test("are suppressed behind a modal, during IME composition and where no handler is bound", () => {
		expect(route(key("F6", plain), focus, true, "Linux")).toBeNull();
		expect(route(key("KeyL"), focus, true, "Linux")).toBeNull();
		expect(route(key("Backquote"), focus, true, "Linux")).toBeNull();
		expect(route(key("F6", { ...plain, isComposing: true }), focus, false, "Linux")).toBeNull();
		expect(route(key("KeyL", { isComposing: true }), focus, false, "Linux")).toBeNull();
		expect(route(key("KeyB", { isComposing: true }), focus, false, "Linux")).toBeNull();
		expect(route(key("Digit1"), all, false, "Linux")).toBeNull();
		expect(route(key("Backquote"), all, false, "Linux")).toBeNull();
		expect(route(key("KeyG", { shiftKey: true }), all, false, "Linux")).toBeNull();
	});
});

describe("tab chords", () => {
	const tabs = { ...all, onCloseTab: noop, onSplitRight: noop, onMoveTab: noop };
	const command = { ctrlKey: false, metaKey: true };

	test("route Mod+Alt+W, Mod+\\ and the platform's move chords, but never bind Mod+W", () => {
		expect(route(key("KeyW", { altKey: true }), tabs, false, "Linux")).toBe("tab.close");
		expect(route(key("KeyW"), tabs, false, "Linux")).toBeNull();
		expect(route(key("KeyW", command), tabs, false, "MacIntel")).toBeNull();
		expect(route(key("Backslash"), tabs, false, "Win32")).toBe("group.splitRight");
		expect(route(key("Backslash", command), tabs, false, "MacIntel")).toBe("group.splitRight");
		expect(route(key("ArrowRight", { altKey: true }), tabs, false, "Linux")).toBe(
			"tab.moveToNextGroup",
		);
		expect(route(key("ArrowLeft", { metaKey: true }), tabs, false, "MacIntel")).toBe(
			"tab.moveToPreviousGroup",
		);
		expect(route(key("ArrowLeft", { altKey: true }), tabs, false, "MacIntel")).toBeNull();
		expect(route(key("Backslash"), all, false, "Linux")).toBeNull();
	});

	test("leave Ctrl+\\ to a terminal's shell and ⌥⌘W to Monaco's find widget", () => {
		expect(route(key("Backslash"), tabs, false, "Linux", true)).toBeNull();
		expect(route(key("Backslash", command), tabs, false, "MacIntel", true)).toBe(
			"group.splitRight",
		);
		expect(
			route(key("KeyW", { ...command, altKey: true }), tabs, false, "MacIntel", false, true),
		).toBeNull();
		expect(route(key("KeyW", { altKey: true }), tabs, false, "Linux", false, true)).toBe(
			"tab.close",
		);
	});

	test("let tab.close through an open modal so it can dismiss the layer, and only it", () => {
		expect(route(key("KeyW", { altKey: true }), tabs, true, "Linux")).toBe("tab.close");
		expect(route(key("Backslash"), tabs, true, "Linux")).toBeNull();
		expect(route(key("ArrowRight", { altKey: true }), tabs, true, "Linux")).toBeNull();
	});

	test("ignore an AltGraph chord", () => {
		const altGraph = { getModifierState: (modifier: string) => modifier === "AltGraph" };
		expect(
			route({ ...key("KeyW", { altKey: true }), ...altGraph }, tabs, false, "Win32"),
		).toBeNull();
		expect(
			route({ ...key("ArrowRight", { altKey: true }), ...altGraph }, tabs, false, "Win32"),
		).toBeNull();
	});
});

test("Mod+? opens the shortcuts on the typed question mark, never behind a modal", () => {
	const withShortcuts = { ...all, onShortcuts: noop };
	const question = key("Slash", { key: "?", shiftKey: true });
	expect(route(question, withShortcuts, false, "Linux")).toBe("shortcuts.open");
	expect(route(key("Digit7", { key: "?", shiftKey: true }), withShortcuts, false, "Linux")).toBe(
		"shortcuts.open",
	);
	expect(
		route(key("Slash", { key: ",", shiftKey: true }), withShortcuts, false, "Linux"),
	).toBeNull();
	expect(route(question, withShortcuts, true, "Linux")).toBeNull();
	expect(route(question, all, false, "Linux")).toBeNull();
});

describe("routing through the resolved table", () => {
	test("a rebound chord routes at once and the replaced default no longer does", () => {
		const keybindings = resolveKeybindings({
			platform: "Linux",
			overrides: { "search.open": ["Mod+Alt+KeyS"], "view.toggleLeft": [] },
		});
		expect(globalHotkeyCommand(key("KeyS", { altKey: true }), all, false, keybindings)).toBe(
			"search.open",
		);
		expect(globalHotkeyCommand(key("KeyK"), all, false, keybindings)).toBeNull();
		expect(globalHotkeyCommand(key("KeyB"), all, false, keybindings)).toBeNull();
	});

	test("an extension command is never routed as an app chord", () => {
		const keybindings = resolveKeybindings({
			platform: "Linux",
			extensions: [
				{
					extension: "hint-mode",
					enabled: true,
					commands: [
						{
							id: "hint-mode.show",
							title: "hintMode.shortcuts.show",
							chords: [{ code: "Semicolon", key: ";", mod: true }],
						},
					],
				},
			],
		});
		expect(globalHotkeyCommand(key("Semicolon"), all, false, keybindings)).toBeNull();
	});
});

describe("the terminal and find guards name chords, not commands", () => {
	const actions = { ...all, onComposer: noop, onSplitRight: noop, onCloseTab: noop };
	const linux = (overrides: Record<string, string[]>) =>
		resolveKeybindings({ platform: "Linux", overrides });
	const mac = (overrides: Record<string, string[]>) =>
		resolveKeybindings({ platform: "MacIntel", overrides });
	const cmdAltW = key("KeyW", { ctrlKey: false, metaKey: true, altKey: true });

	test("a command rebound off the terminal's or find's chord acts there, and that chord still yields", () => {
		const ctrlAltY = key("KeyY", { altKey: true });
		const cmdAltY = key("KeyY", { ctrlKey: false, metaKey: true, altKey: true });
		const composer = linux({ "focus.composer": ["Mod+Alt+KeyY"] });
		expect(globalHotkeyCommand(ctrlAltY, actions, false, composer, true)).toBe("focus.composer");
		expect(globalHotkeyCommand(key("KeyL"), actions, false, composer, true)).toBeNull();
		const split = linux({ "group.splitRight": ["Mod+Alt+KeyY"] });
		expect(globalHotkeyCommand(ctrlAltY, actions, false, split, true)).toBe("group.splitRight");
		expect(globalHotkeyCommand(key("Backslash"), actions, false, split, true)).toBeNull();
		const close = mac({ "tab.close": ["Mod+Alt+KeyY"] });
		expect(globalHotkeyCommand(cmdAltY, actions, false, close, false, true)).toBe("tab.close");
		expect(globalHotkeyCommand(cmdAltW, actions, false, close, false, true)).toBeNull();
	});

	test("a command rebound onto the terminal's or find's chord yields there and acts elsewhere", () => {
		const ontoShell = linux({ "search.open": ["Mod+KeyL", "Ctrl+KeyR"], "focus.composer": [] });
		for (const pressed of [key("KeyL"), key("KeyR")]) {
			expect(globalHotkeyCommand(pressed, actions, false, ontoShell, true)).toBeNull();
			expect(globalHotkeyCommand(pressed, actions, false, ontoShell)).toBe("search.open");
		}
		const ontoFind = mac({ "view.toggleLeft": ["Mod+Alt+KeyW"] });
		expect(globalHotkeyCommand(cmdAltW, actions, false, ontoFind, false, true)).toBeNull();
		expect(globalHotkeyCommand(cmdAltW, actions, false, ontoFind)).toBe("view.toggleLeft");
	});
});

describe("routing a press", () => {
	const at = (
		desktop: ShortcutPlatform,
		keybindings: ResolvedKeybindings,
		place: { inTerminal?: boolean } = {},
	): Parameters<typeof routeHotkey>[2] => ({
		keybindings,
		desktop,
		modalOpen: false,
		textEntry: false,
		surface: null,
		inTerminal: false,
		inEditorFind: false,
		...place,
	});
	const azertyCtrlW = key("KeyZ", { key: "w" });
	const russianCtrlComma = key("Slash", { key: ",", shiftKey: true });

	test("a press the desktop's shortcutCommands owns runs no app command, whatever it resolves to", () => {
		const keybindings = resolveKeybindings({
			platform: "Linux",
			overrides: { "view.toggleLeft": ["Mod+KeyZ"], "view.toggleRight": ["Mod+Shift+Slash"] },
		});
		for (const desktop of ["linux", "windows"] as const) {
			expect(routeHotkey(azertyCtrlW, all, at(desktop, keybindings))).toBeNull();
			expect(routeHotkey(russianCtrlComma, all, at(desktop, keybindings))).toBeNull();
		}
		expect(routeHotkey(azertyCtrlW, all, at("browser", keybindings))).toEqual({
			kind: "command",
			id: "view.toggleLeft",
		});
		expect(routeHotkey(russianCtrlComma, all, at("browser", keybindings))).toEqual({
			kind: "command",
			id: "view.toggleRight",
		});
		expect(routeHotkey(key("KeyZ", { key: "z" }), all, at("linux", keybindings))).toEqual({
			kind: "command",
			id: "view.toggleLeft",
		});
	});

	test("a press the desktop owns runs no extension command or chat history either", () => {
		const keybindings = resolveKeybindings({
			platform: "Linux",
			overrides: { "hint-mode.show": ["Mod+KeyZ"], "chat.history": ["Mod+Shift+Slash"] },
			extensions: [
				{
					extension: "hint-mode",
					enabled: true,
					commands: [
						{
							id: "hint-mode.show",
							title: "hintMode.shortcuts.show",
							chords: [{ code: "Semicolon", key: ";", mod: true }],
						},
					],
				},
			],
		});
		expect(routeHotkey(azertyCtrlW, all, at("linux", keybindings))).toBeNull();
		expect(routeHotkey(russianCtrlComma, all, at("windows", keybindings))).toBeNull();
		expect(routeHotkey(azertyCtrlW, all, at("browser", keybindings))).toEqual({
			kind: "extension",
			extension: "hint-mode",
			id: "hint-mode.show",
		});
		expect(routeHotkey(russianCtrlComma, all, at("browser", keybindings))).toEqual({
			kind: "history",
		});
	});

	test("chat history rebound off Ctrl+R opens from a terminal, which keeps Ctrl+R", () => {
		const moved = resolveKeybindings({
			platform: "Linux",
			overrides: { "chat.history": ["Mod+Alt+KeyY"] },
		});
		const ctrlAltY = key("KeyY", { altKey: true });
		expect(routeHotkey(ctrlAltY, all, at("linux", moved, { inTerminal: true }))).toEqual({
			kind: "history",
		});
		const defaults = resolveKeybindings({ platform: "Linux" });
		expect(routeHotkey(key("KeyR"), all, at("linux", defaults, { inTerminal: true }))).toBeNull();
		expect(routeHotkey(key("KeyR"), all, at("linux", defaults))).toEqual({ kind: "history" });
	});
});
