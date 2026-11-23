import { describe, expect, test } from "bun:test";
import type { RegisteredPanel } from "../extensions";
import { type ResolvedKeybindings, resolveKeybindings } from "../keybindings";
import { railCommandPanel } from "./extensionPanelHost";
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
		keyCode: number;
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

	test("routes Mod+Shift+F12 to hide all panels, from xterm too, never behind a modal or without a workspace", () => {
		const withAllPanels = { ...all, onAllPanels: noop };
		const hideAll = key("F12", { key: "F12", shiftKey: true });
		expect(route(hideAll, withAllPanels, false, "Linux")).toBe("view.toggleAllPanels");
		expect(
			route(
				key("F12", { key: "F12", ctrlKey: false, metaKey: true, shiftKey: true }),
				withAllPanels,
				false,
				"MacIntel",
			),
		).toBe("view.toggleAllPanels");
		expect(route(hideAll, withAllPanels, false, "Linux", true)).toBe("view.toggleAllPanels");
		expect(route(hideAll, withAllPanels, true, "Linux")).toBeNull();
		expect(route(hideAll, all, false, "Linux")).toBeNull();
		expect(route(key("F12", { key: "F12" }), withAllPanels, false, "Linux")).toBeNull();
		expect(
			route(
				key("F12", { key: "F12", ctrlKey: false, shiftKey: true }),
				withAllPanels,
				false,
				"Linux",
			),
		).toBeNull();
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
		place: Partial<Parameters<typeof routeHotkey>[2]> = {},
	): Parameters<typeof routeHotkey>[2] => ({
		keybindings,
		desktop,
		modalOpen: false,
		textEntry: false,
		localScopes: [],
		inTerminal: false,
		inEditorFind: false,
		inCodeEditor: false,
		hasSuggestion: () => false,
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

	const hint = {
		extension: "hint-mode",
		enabled: true,
		commands: [
			{
				id: "hint-mode.show",
				title: "hintMode.shortcuts.show",
				chords: [
					{ code: "KeyF", key: "f" },
					{ code: "Semicolon", key: ";", mod: true },
				],
			},
		],
	} as const;
	const HINT = { kind: "extension", extension: "hint-mode", id: "hint-mode.show" } as const;

	test("a key a focused element's local command holds yields to that element; elsewhere the global acts", () => {
		const plainF = key("KeyF", { key: "f", ctrlKey: false });
		const searchOnF = resolveKeybindings({
			platform: "Linux",
			overrides: { "trees.search": ["KeyF"] },
			extensions: [hint],
		});
		expect(
			routeHotkey(plainF, all, at("browser", searchOnF, { localScopes: ["trees"] })),
		).toBeNull();
		expect(
			routeHotkey(plainF, all, at("browser", searchOnF, { localScopes: ["transcript"] })),
		).toEqual(HINT);
		expect(routeHotkey(plainF, all, at("browser", searchOnF))).toEqual(HINT);
		const defaults = resolveKeybindings({ platform: "Linux", extensions: [hint] });
		expect(routeHotkey(plainF, all, at("browser", defaults, { localScopes: ["trees"] }))).toEqual(
			HINT,
		);
		const searchOnK = resolveKeybindings({
			platform: "Linux",
			overrides: { "trees.search": ["Mod+KeyK"] },
		});
		expect(
			routeHotkey(key("KeyK"), all, at("browser", searchOnK, { localScopes: ["trees"] })),
		).toBeNull();
		expect(routeHotkey(key("KeyK"), all, at("browser", searchOnK))).toEqual({
			kind: "command",
			id: "search.open",
		});
	});

	test("a review surface yields the Shift variant of an arrow twin it extends the selection with; other elements do not", () => {
		const downOnModJ = resolveKeybindings({
			platform: "Linux",
			overrides: { "arrows.down": ["Mod+KeyJ"] },
		});
		const modJ = key("KeyJ", { key: "j" });
		const shiftModJ = key("KeyJ", { key: "J", shiftKey: true });
		const cursor = { localScopes: ["review.surface", "review"] };
		const bottom = { kind: "command", id: "view.toggleBottom" } as const;
		expect(routeHotkey(modJ, all, at("browser", downOnModJ, cursor))).toBeNull();
		expect(routeHotkey(shiftModJ, all, at("browser", downOnModJ, cursor))).toBeNull();
		expect(
			routeHotkey(shiftModJ, all, at("browser", downOnModJ, { localScopes: ["trees"] })),
		).toEqual(bottom);
		expect(routeHotkey(shiftModJ, all, at("browser", downOnModJ))).toEqual(bottom);
		const defaults = resolveKeybindings({ platform: "Linux" });
		expect(routeHotkey(shiftModJ, all, at("browser", defaults, cursor))).toEqual(bottom);
	});

	test("the element's keys are physical: whatever the layout types, the code decides who acts", () => {
		const hintOnS = resolveKeybindings({
			platform: "Linux",
			overrides: { "hint-mode.show": ["KeyS"] },
			extensions: [hint],
		});
		const russianS = key("KeyS", { key: "ы", ctrlKey: false });
		expect(
			routeHotkey(russianS, all, at("browser", hintOnS, { localScopes: ["trees"] })),
		).toBeNull();
		expect(
			routeHotkey(russianS, all, at("browser", hintOnS, { localScopes: ["transcript"] })),
		).toEqual(HINT);
		const dvorakK = key("KeyV", { key: "k", ctrlKey: false });
		const hintOnV = resolveKeybindings({
			platform: "Linux",
			overrides: { "hint-mode.show": ["KeyV"] },
			extensions: [hint],
		});
		expect(
			routeHotkey(dvorakK, all, at("browser", hintOnV, { localScopes: ["transcript"] })),
		).toEqual(HINT);
	});

	test("a typing local key does not hold its element's text fields; a chord does", () => {
		const searchOnF = resolveKeybindings({
			platform: "Linux",
			overrides: { "trees.search": ["KeyF"], "trees.openKept": ["Mod+KeyK"] },
			extensions: [hint],
		});
		const inField = { localScopes: ["trees"], textEntry: true };
		expect(
			routeHotkey(key("KeyF", { ctrlKey: false }), all, at("browser", searchOnF, inField)),
		).toBeNull();
		expect(routeHotkey(key("KeyK"), all, at("browser", searchOnF, inField))).toBeNull();
		expect(routeHotkey(key("Semicolon"), all, at("browser", searchOnF, inField))).toEqual(HINT);
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

	describe("next-step chips", () => {
		const defaults = resolveKeybindings({ platform: "Linux" });
		const altDigit = (n: number, extra: Parameters<typeof key>[1] = {}) =>
			key(`Digit${n}`, { key: String(n), ctrlKey: false, altKey: true, ...extra });
		const chips = (count: number) => (index: number) => index < count;

		test("Alt+N sends and Shift+Alt+N edits chip N from anywhere, only while that chip is shown", () => {
			const shown = { hasSuggestion: chips(2) };
			expect(routeHotkey(altDigit(2), all, at("browser", defaults, shown))).toEqual({
				kind: "suggestion",
				index: 1,
				edit: false,
			});
			expect(
				routeHotkey(altDigit(1, { shiftKey: true }), all, at("browser", defaults, shown)),
			).toEqual({ kind: "suggestion", index: 0, edit: true });
			for (const place of [
				{ localScopes: ["trees"] },
				{ localScopes: ["tabs"] },
				{ localScopes: ["ask-user-question.card"] },
				{ localScopes: ["composer"], textEntry: true },
			]) {
				expect(
					routeHotkey(altDigit(1), all, at("browser", defaults, { ...shown, ...place })),
				).toEqual({ kind: "suggestion", index: 0, edit: false });
			}
			expect(routeHotkey(altDigit(3), all, at("browser", defaults, shown))).toBeNull();
			expect(routeHotkey(altDigit(1), all, at("browser", defaults))).toBeNull();
		});

		test("the terminal, the code editor, a modal and IME composition keep the key", () => {
			const shown = { hasSuggestion: chips(9) };
			for (const place of [{ inTerminal: true }, { inCodeEditor: true }, { modalOpen: true }]) {
				expect(
					routeHotkey(altDigit(1), all, at("browser", defaults, { ...shown, ...place })),
				).toBeNull();
			}
			expect(
				routeHotkey(altDigit(1, { isComposing: true }), all, at("browser", defaults, shown)),
			).toBeNull();
			expect(
				routeHotkey(altDigit(1, { keyCode: 229 }), all, at("browser", defaults, shown)),
			).toBeNull();
			expect(
				routeHotkey(
					altDigit(1, { shiftKey: true, keyCode: 229 }),
					all,
					at("browser", defaults, shown),
				),
			).toBeNull();
		});

		test("a rebound chip key acts on its new chord, and a focused element's local key wins it", () => {
			const shown = { hasSuggestion: chips(9) };
			const moved = resolveKeybindings({
				platform: "Linux",
				overrides: { "suggestions.send1": ["Mod+Alt+Digit1"] },
			});
			expect(routeHotkey(altDigit(1), all, at("browser", moved, shown))).toBeNull();
			expect(routeHotkey(altDigit(1, { ctrlKey: true }), all, at("browser", moved, shown))).toEqual(
				{ kind: "suggestion", index: 0, edit: false },
			);
			const treeTakesIt = resolveKeybindings({
				platform: "Linux",
				overrides: { "trees.search": ["Alt+Digit1"] },
			});
			expect(
				routeHotkey(
					altDigit(1),
					all,
					at("browser", treeTakesIt, { ...shown, localScopes: ["trees"] }),
				),
			).toBeNull();
			expect(routeHotkey(altDigit(1), all, at("browser", treeTakesIt, shown))).toEqual({
				kind: "suggestion",
				index: 0,
				edit: false,
			});
		});
	});

	test("chat history rebound off Ctrl+R waits out IME composition; the literal Ctrl+R still wins it", () => {
		const onF6 = resolveKeybindings({ platform: "Linux", overrides: { "chat.history": ["F6"] } });
		const f6 = (isComposing: boolean) => key("F6", { key: "F6", ctrlKey: false, isComposing });
		expect(routeHotkey(f6(true), all, at("browser", onF6))).toBeNull();
		expect(routeHotkey(f6(false), all, at("browser", onF6))).toEqual({ kind: "history" });
		const defaults = resolveKeybindings({ platform: "Linux" });
		expect(routeHotkey(key("KeyR", { isComposing: true }), all, at("browser", defaults))).toEqual({
			kind: "history",
		});
	});

	test("a panel's rail chord opens the panel while it is openable and no modal is up, and reaches no overlay", () => {
		const panel: RegisteredPanel = {
			extension: "insights",
			panel: "sessions",
			declaration: {
				title: "common.retry",
				icon: () => null,
				scopes: ["project"],
				rail: { command: "insights.open" },
				load: async () => ({ default: () => null }),
			},
		};
		const extensions = [
			{
				extension: "insights",
				enabled: true,
				commands: [
					{
						id: "insights.open",
						title: "common.retry" as const,
						chords: [{ code: "KeyI", key: "I", ctrl: true, alt: true }],
					},
				],
			},
			hint,
		];
		const ctrlAltI = key("KeyI", { key: "i", altKey: true });
		const openable = (panels: readonly RegisteredPanel[]) => (extension: string, id: string) =>
			railCommandPanel(extension, id, () => panels, [panel]);
		for (const platform of ["Linux", "MacIntel"]) {
			const keybindings = resolveKeybindings({ platform, extensions });
			const place = (panels: readonly RegisteredPanel[], modalOpen = false) => ({
				...at("browser", keybindings),
				modalOpen,
				railPanel: openable(panels),
			});
			expect(routeHotkey(ctrlAltI, all, place([panel]))).toEqual({ kind: "panel", panel });
			expect(routeHotkey(ctrlAltI, all, place([]))).toBeNull();
			expect(routeHotkey(ctrlAltI, all, place([panel], true))).toBeNull();
			const modSemicolon = key("Semicolon", {
				ctrlKey: platform === "Linux",
				metaKey: platform === "MacIntel",
			});
			expect(routeHotkey(modSemicolon, all, place([panel]))).toEqual(HINT);
			const rebound = resolveKeybindings({
				platform,
				extensions,
				overrides: { "insights.open": ["Mod+Shift+KeyY"] },
			});
			const modShiftY = key("KeyY", {
				key: "y",
				shiftKey: true,
				ctrlKey: platform === "Linux",
				metaKey: platform === "MacIntel",
			});
			const there = { ...place([panel]), keybindings: rebound };
			expect(routeHotkey(modShiftY, all, there)).toEqual({ kind: "panel", panel });
			expect(routeHotkey(ctrlAltI, all, there)).toBeNull();
		}
	});
});
