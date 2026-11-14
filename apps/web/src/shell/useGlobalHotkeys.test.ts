import { describe, expect, test } from "bun:test";
import { globalHotkeyCommand } from "./useGlobalHotkeys";

const key = (
	code: string,
	overrides: Partial<{
		ctrlKey: boolean;
		metaKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
		isComposing: boolean;
	}> = {},
) => ({
	code,
	ctrlKey: true,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	isComposing: false,
	...overrides,
});

const noop = () => {};

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
		expect(globalHotkeyCommand(key("KeyB"), all, false, "Linux")).toBe("view.toggleLeft");
		expect(globalHotkeyCommand(key("KeyJ"), all, false, "Linux")).toBe("view.toggleRight");
		expect(globalHotkeyCommand(key("KeyJ", { shiftKey: true }), all, false, "Linux")).toBe(
			"view.toggleBottom",
		);
		expect(
			globalHotkeyCommand(
				key("KeyJ", { ctrlKey: false, metaKey: true, shiftKey: true }),
				all,
				false,
				"MacIntel",
			),
		).toBe("view.toggleBottom");
		expect(globalHotkeyCommand(key("KeyK", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyB", { altKey: true }), all, false, "Linux")).toBeNull();
	});

	test("routes Mod+K to search when available, suppressed behind modal", () => {
		expect(globalHotkeyCommand(key("KeyK"), all, false, "Linux")).toBe("search.open");
		expect(
			globalHotkeyCommand(key("KeyK", { ctrlKey: false, metaKey: true }), all, false, "MacIntel"),
		).toBe("search.open");
		expect(globalHotkeyCommand(key("KeyK"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyK"), withoutSearch, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyK", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyK", { altKey: true }), all, false, "Linux")).toBeNull();
	});

	test("routes Mod+N and the Mod+Alt+N alias to new-workspace, never with Shift, never when unavailable or behind a modal", () => {
		expect(globalHotkeyCommand(key("KeyN"), all, false, "Linux")).toBe("workspace.new");
		expect(
			globalHotkeyCommand(key("KeyN", { ctrlKey: false, metaKey: true }), all, false, "MacIntel"),
		).toBe("workspace.new");
		expect(globalHotkeyCommand(key("KeyN", { altKey: true }), all, false, "Linux")).toBe(
			"workspace.new",
		);
		expect(
			globalHotkeyCommand(
				key("KeyN", { ctrlKey: false, metaKey: true, altKey: true }),
				all,
				false,
				"MacIntel",
			),
		).toBe("workspace.new");
		expect(globalHotkeyCommand(key("KeyN", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyN"), withoutNewWorkspace, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyN"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyN", { metaKey: false }), all, false, "MacIntel")).toBeNull();
	});

	test("routes Mod+Shift+F to find-in-files only when available, never with Alt or behind a modal; plain Mod+F stays the browser's", () => {
		const withFind = { ...all, onFindInFiles: noop };
		expect(globalHotkeyCommand(key("KeyF", { shiftKey: true }), withFind, false, "Linux")).toBe(
			"files.findInFiles",
		);
		expect(
			globalHotkeyCommand(
				key("KeyF", { ctrlKey: false, metaKey: true, shiftKey: true }),
				withFind,
				false,
				"MacIntel",
			),
		).toBe("files.findInFiles");
		expect(globalHotkeyCommand(key("KeyF", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyF"), withFind, false, "Linux")).toBeNull();
		expect(
			globalHotkeyCommand(key("KeyF", { shiftKey: true, altKey: true }), withFind, false, "Linux"),
		).toBeNull();
		expect(
			globalHotkeyCommand(key("KeyF", { shiftKey: true }), withFind, true, "Linux"),
		).toBeNull();
	});

	test("does not claim unavailable workspace commands or any panel chord behind a modal", () => {
		expect(
			globalHotkeyCommand(key("KeyJ", { shiftKey: true }), { onProjects: noop }, false, "Linux"),
		).toBeNull();
		expect(globalHotkeyCommand(key("KeyB"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyJ"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyJ", { shiftKey: true }), all, true, "Linux")).toBeNull();
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
			expect(globalHotkeyCommand(key("F6", plain), focus, false, platform)).toBe("region.next");
			expect(
				globalHotkeyCommand(key("F6", { ...plain, shiftKey: true }), focus, false, platform),
			).toBe("region.previous");
			expect(globalHotkeyCommand(key("KeyL", mod), focus, false, platform)).toBe("focus.composer");
			expect(globalHotkeyCommand(key("Digit0", mod), focus, false, platform)).toBe(
				"focus.projects",
			);
			expect(globalHotkeyCommand(key("Digit1", mod), focus, false, platform)).toBe("focus.group1");
			expect(globalHotkeyCommand(key("Digit9", mod), focus, false, platform)).toBe("focus.group9");
			expect(globalHotkeyCommand(key("Backquote"), focus, false, platform)).toBe("focus.terminal");
			expect(
				globalHotkeyCommand(key("KeyE", { ...mod, shiftKey: true }), focus, false, platform),
			).toBe("view.files");
			expect(
				globalHotkeyCommand(key("KeyG", { ...mod, shiftKey: true }), focus, false, platform),
			).toBe("view.changes");
		}
	});

	test("leave Ctrl+L to a focused terminal's shell, but take Cmd+L there on a Mac", () => {
		expect(globalHotkeyCommand(key("KeyL"), focus, false, "Linux", true)).toBeNull();
		expect(globalHotkeyCommand(key("KeyL"), focus, false, "Win32", true)).toBeNull();
		expect(globalHotkeyCommand(key("KeyL", command), focus, false, "MacIntel", true)).toBe(
			"focus.composer",
		);
		expect(globalHotkeyCommand(key("F6", plain), focus, false, "Linux", true)).toBe("region.next");
		expect(globalHotkeyCommand(key("Backquote"), focus, false, "Linux", true)).toBe(
			"focus.terminal",
		);
	});

	test("leave Ctrl+F6 to the workbench and Numpad0 to page zoom", () => {
		expect(globalHotkeyCommand(key("F6"), focus, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("F6", { shiftKey: true }), focus, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("Numpad0"), focus, false, "Linux")).toBeNull();
		expect(
			globalHotkeyCommand(key("Digit0", { shiftKey: true }), focus, false, "Linux"),
		).toBeNull();
	});

	test("are suppressed behind a modal, during IME composition and where no handler is bound", () => {
		expect(globalHotkeyCommand(key("F6", plain), focus, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyL"), focus, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("Backquote"), focus, true, "Linux")).toBeNull();
		expect(
			globalHotkeyCommand(key("F6", { ...plain, isComposing: true }), focus, false, "Linux"),
		).toBeNull();
		expect(
			globalHotkeyCommand(key("KeyL", { isComposing: true }), focus, false, "Linux"),
		).toBeNull();
		expect(
			globalHotkeyCommand(key("KeyB", { isComposing: true }), focus, false, "Linux"),
		).toBeNull();
		expect(globalHotkeyCommand(key("Digit1"), all, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("Backquote"), all, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyG", { shiftKey: true }), all, false, "Linux")).toBeNull();
	});
});

describe("tab chords", () => {
	const tabs = { ...all, onCloseTab: noop, onSplitRight: noop, onMoveTab: noop };
	const command = { ctrlKey: false, metaKey: true };

	test("route Mod+Alt+W, Mod+\\ and the platform's move chords, but never bind Mod+W", () => {
		expect(globalHotkeyCommand(key("KeyW", { altKey: true }), tabs, false, "Linux")).toBe(
			"tab.close",
		);
		expect(globalHotkeyCommand(key("KeyW"), tabs, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyW", command), tabs, false, "MacIntel")).toBeNull();
		expect(globalHotkeyCommand(key("Backslash"), tabs, false, "Win32")).toBe("group.splitRight");
		expect(globalHotkeyCommand(key("Backslash", command), tabs, false, "MacIntel")).toBe(
			"group.splitRight",
		);
		expect(globalHotkeyCommand(key("ArrowRight", { altKey: true }), tabs, false, "Linux")).toBe(
			"tab.moveToNextGroup",
		);
		expect(globalHotkeyCommand(key("ArrowLeft", { metaKey: true }), tabs, false, "MacIntel")).toBe(
			"tab.moveToPreviousGroup",
		);
		expect(
			globalHotkeyCommand(key("ArrowLeft", { altKey: true }), tabs, false, "MacIntel"),
		).toBeNull();
		expect(globalHotkeyCommand(key("Backslash"), all, false, "Linux")).toBeNull();
	});

	test("leave Ctrl+\\ to a terminal's shell and ⌥⌘W to Monaco's find widget", () => {
		expect(globalHotkeyCommand(key("Backslash"), tabs, false, "Linux", true)).toBeNull();
		expect(globalHotkeyCommand(key("Backslash", command), tabs, false, "MacIntel", true)).toBe(
			"group.splitRight",
		);
		expect(
			globalHotkeyCommand(
				key("KeyW", { ...command, altKey: true }),
				tabs,
				false,
				"MacIntel",
				false,
				true,
			),
		).toBeNull();
		expect(
			globalHotkeyCommand(key("KeyW", { altKey: true }), tabs, false, "Linux", false, true),
		).toBe("tab.close");
	});

	test("let tab.close through an open modal so it can dismiss the layer, and only it", () => {
		expect(globalHotkeyCommand(key("KeyW", { altKey: true }), tabs, true, "Linux")).toBe(
			"tab.close",
		);
		expect(globalHotkeyCommand(key("Backslash"), tabs, true, "Linux")).toBeNull();
		expect(
			globalHotkeyCommand(key("ArrowRight", { altKey: true }), tabs, true, "Linux"),
		).toBeNull();
	});

	test("ignore an AltGraph chord", () => {
		const altGraph = { getModifierState: (modifier: string) => modifier === "AltGraph" };
		expect(
			globalHotkeyCommand({ ...key("KeyW", { altKey: true }), ...altGraph }, tabs, false, "Win32"),
		).toBeNull();
		expect(
			globalHotkeyCommand(
				{ ...key("ArrowRight", { altKey: true }), ...altGraph },
				tabs,
				false,
				"Win32",
			),
		).toBeNull();
	});
});
