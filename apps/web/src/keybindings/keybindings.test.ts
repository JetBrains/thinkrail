import { describe, expect, test } from "bun:test";
import {
	FOCUS_GROUP_BINDINGS,
	KEYBINDINGS,
	type KeybindingId,
	keybindingLabel,
	keybindingLabels,
	keybindingShortcut,
	matchKeybinding,
} from ".";

type Modifiers = Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>>;

type Chord = (typeof KEYBINDINGS)[KeybindingId][number];

const PLATFORMS = {
	apple: "MacIntel",
	windows: "Win32",
	linux: "Linux x86_64",
	other: "",
} as const;

const press = (code: string, modifiers: Modifiers = {}) => ({
	code,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
});

const withAltGraph = (event: ReturnType<typeof press>) => ({
	...event,
	getModifierState: (key: string) => key === "AltGraph",
});

const entries = Object.entries(KEYBINDINGS) as [KeybindingId, (typeof KEYBINDINGS)[KeybindingId]][];

describe.each(Object.entries(PLATFORMS))("keybindings on %s", (family, platform) => {
	const mod: Modifiers = family === "apple" ? { metaKey: true } : { ctrlKey: true };
	const other: Modifiers = family === "apple" ? { ctrlKey: true } : { metaKey: true };

	test("every app chord matches its binding on the physical key", () => {
		expect(matchKeybinding(press("KeyB", mod), platform)).toBe("view.toggleLeft");
		expect(matchKeybinding(press("KeyJ", mod), platform)).toBe("view.toggleRight");
		expect(matchKeybinding(press("KeyJ", { ...mod, shiftKey: true }), platform)).toBe(
			"view.toggleBottom",
		);
		expect(matchKeybinding(press("KeyK", mod), platform)).toBe("search.open");
		expect(matchKeybinding(press("KeyF", { ...mod, shiftKey: true }), platform)).toBe(
			"files.findInFiles",
		);
		expect(matchKeybinding(press("KeyR", { ctrlKey: true }), platform)).toBe("chat.history");
	});

	test("Mod+N and its Mod+Alt+N alias both start a workspace, never with Shift", () => {
		expect(matchKeybinding(press("KeyN", mod), platform)).toBe("workspace.new");
		expect(matchKeybinding(press("KeyN", { ...mod, altKey: true }), platform)).toBe(
			"workspace.new",
		);
		expect(matchKeybinding(press("KeyN", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(
			matchKeybinding(press("KeyN", { ...mod, shiftKey: true, altKey: true }), platform),
		).toBeNull();
	});

	test("Mod+K rejects Shift and Alt, and Alt belongs only to the listed aliases and tab moves", () => {
		const altBindings = entries
			.filter(([, chords]) => chords.some((chord: Chord) => chord.alt === true))
			.map(([id]) => id)
			.sort();
		expect(altBindings).toEqual([
			"tab.close",
			"tab.moveToNextGroup",
			"tab.moveToPreviousGroup",
			"workspace.new",
		]);
		expect(matchKeybinding(press("KeyK", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("KeyK", { ...mod, altKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("KeyB", { ...mod, altKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("KeyJ", { ...mod, altKey: true }), platform)).toBeNull();
		expect(
			matchKeybinding(press("KeyJ", { ...mod, shiftKey: true, altKey: true }), platform),
		).toBeNull();
		expect(
			matchKeybinding(press("KeyF", { ...mod, shiftKey: true, altKey: true }), platform),
		).toBeNull();
	});

	test("Mod+Alt+W closes a tab and Mod+\\ splits right, while Mod+W stays the native owner's", () => {
		expect(matchKeybinding(press("KeyW", { ...mod, altKey: true }), platform)).toBe("tab.close");
		expect(matchKeybinding(press("KeyW", mod), platform)).toBeNull();
		expect(
			matchKeybinding(press("KeyW", { ...mod, altKey: true, shiftKey: true }), platform),
		).toBeNull();
		expect(matchKeybinding(press("Backslash", mod), platform)).toBe("group.splitRight");
		expect(matchKeybinding(press("Backslash", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("Backslash", { ...mod, altKey: true }), platform)).toBeNull();
	});

	test("move a tab with Ctrl+Cmd+arrows on Apple and Ctrl+Alt+arrows elsewhere", () => {
		const move: Modifiers =
			family === "apple" ? { ctrlKey: true, metaKey: true } : { ctrlKey: true, altKey: true };
		const foreign: Modifiers =
			family === "apple" ? { ctrlKey: true, altKey: true } : { ctrlKey: true, metaKey: true };
		expect(matchKeybinding(press("ArrowLeft", move), platform)).toBe("tab.moveToPreviousGroup");
		expect(matchKeybinding(press("ArrowRight", move), platform)).toBe("tab.moveToNextGroup");
		expect(matchKeybinding(press("ArrowRight", foreign), platform)).toBeNull();
		expect(matchKeybinding(press("ArrowRight", mod), platform)).toBeNull();
		expect(matchKeybinding(press("ArrowRight", { ...move, shiftKey: true }), platform)).toBeNull();
	});

	test("no Alt chord matches while AltGraph is held", () => {
		const altGr: Modifiers = { ctrlKey: true, altKey: true };
		for (const code of ["KeyN", "KeyW", "ArrowLeft", "ArrowRight"]) {
			expect(
				matchKeybinding(withAltGraph(press(code, { ...mod, altKey: true })), platform),
			).toBeNull();
			expect(matchKeybinding(withAltGraph(press(code, altGr)), platform)).toBeNull();
		}
		expect(matchKeybinding(withAltGraph(press("KeyB", mod)), platform)).toBe("view.toggleLeft");
	});

	test("region, focus and tool chords match on their physical keys", () => {
		expect(matchKeybinding(press("F6"), platform)).toBe("region.next");
		expect(matchKeybinding(press("F6", { shiftKey: true }), platform)).toBe("region.previous");
		expect(matchKeybinding(press("KeyL", mod), platform)).toBe("focus.composer");
		expect(matchKeybinding(press("Digit0", mod), platform)).toBe("focus.projects");
		for (const [index, id] of FOCUS_GROUP_BINDINGS.entries()) {
			expect(matchKeybinding(press(`Digit${index + 1}`, mod), platform)).toBe(id);
		}
		expect(matchKeybinding(press("Backquote", { ctrlKey: true }), platform)).toBe("focus.terminal");
		expect(matchKeybinding(press("KeyE", { ...mod, shiftKey: true }), platform)).toBe("view.files");
		expect(matchKeybinding(press("KeyG", { ...mod, shiftKey: true }), platform)).toBe(
			"view.changes",
		);
	});

	test("Numpad0 and Mod+Shift+0 never focus Projects, and Ctrl+F6 stays the workbench's", () => {
		expect(matchKeybinding(press("Numpad0", mod), platform)).toBeNull();
		expect(matchKeybinding(press("Digit0", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("Digit0"), platform)).toBeNull();
		expect(matchKeybinding(press("F6", { ctrlKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("F6", { ctrlKey: true, shiftKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("F6", mod), platform)).toBeNull();
		expect(matchKeybinding(press("KeyE", mod), platform)).toBeNull();
		expect(matchKeybinding(press("KeyL", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("Backquote"), platform)).toBeNull();
	});

	test("a missing, extra or wrong modifier does not match", () => {
		expect(matchKeybinding(press("KeyB"), platform)).toBeNull();
		expect(matchKeybinding(press("KeyB", other), platform)).toBeNull();
		expect(matchKeybinding(press("KeyB", { ...mod, ...other }), platform)).toBeNull();
		expect(matchKeybinding(press("KeyB", { ...mod, shiftKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("KeyF", mod), platform)).toBeNull();
		expect(matchKeybinding(press("KeyR"), platform)).toBeNull();
		expect(matchKeybinding(press("KeyR", { ctrlKey: true, metaKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("KeyR", { ctrlKey: true, shiftKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("KeyR", { ctrlKey: true, altKey: true }), platform)).toBeNull();
		expect(matchKeybinding(press("KeyX", mod), platform)).toBeNull();
	});
});

test("Ctrl+R and Ctrl+` are literal Control on Apple, where Cmd+R and Cmd+` stay the system's", () => {
	expect(matchKeybinding(press("KeyR", { ctrlKey: true }), PLATFORMS.apple)).toBe("chat.history");
	expect(matchKeybinding(press("KeyR", { metaKey: true }), PLATFORMS.apple)).toBeNull();
	expect(matchKeybinding(press("KeyB", { ctrlKey: true }), PLATFORMS.apple)).toBeNull();
	expect(matchKeybinding(press("Backquote", { ctrlKey: true }), PLATFORMS.apple)).toBe(
		"focus.terminal",
	);
	expect(matchKeybinding(press("Backquote", { metaKey: true }), PLATFORMS.apple)).toBeNull();
});

test("every chord resolves to its own binding and no two bindings share a chord on a platform", () => {
	for (const platform of Object.values(PLATFORMS)) {
		const apple = platform === PLATFORMS.apple;
		const owners = new Map<string, KeybindingId>();
		for (const [id, chords] of entries) {
			for (const chord of chords as readonly Chord[]) {
				if (chord.platform !== undefined && (chord.platform === "apple") !== apple) continue;
				const event = press(chord.code, {
					ctrlKey: chord.ctrl === true || (chord.mod === true && !apple),
					metaKey: chord.mod === true && apple,
					shiftKey: chord.shift === true,
					altKey: chord.alt === true,
				});
				const signature = JSON.stringify(event);
				expect(owners.get(signature) ?? id).toBe(id);
				owners.set(signature, id);
				expect(matchKeybinding(event, platform)).toBe(chord.displayOnly ? null : id);
			}
		}
	}
});

describe("keybinding shortcuts", () => {
	test("show a binding's first chord as a display shortcut", () => {
		expect(keybindingShortcut("view.toggleLeft")).toEqual({ key: "B", mod: true });
		expect(keybindingShortcut("view.toggleRight")).toEqual({ key: "J", mod: true });
		expect(keybindingShortcut("view.toggleBottom")).toEqual({ key: "J", mod: true, shift: true });
		expect(keybindingShortcut("search.open")).toEqual({ key: "K", mod: true });
		expect(keybindingShortcut("files.findInFiles")).toEqual({ key: "F", mod: true, shift: true });
		expect(keybindingShortcut("chat.history")).toEqual({ key: "R", ctrl: true });
		expect(keybindingShortcut("region.next")).toEqual({ key: "F6" });
		expect(keybindingShortcut("region.previous")).toEqual({ key: "F6", shift: true });
		expect(keybindingShortcut("focus.composer")).toEqual({ key: "L", mod: true });
		expect(keybindingShortcut("focus.projects")).toEqual({ key: "0", mod: true });
		expect(keybindingShortcut("focus.group3")).toEqual({ key: "3", mod: true });
		expect(keybindingShortcut("focus.terminal")).toEqual({ key: "`", ctrl: true });
		expect(keybindingShortcut("view.files")).toEqual({ key: "E", mod: true, shift: true });
		expect(keybindingShortcut("view.changes")).toEqual({ key: "G", mod: true, shift: true });
		expect(keybindingShortcut("group.splitRight")).toEqual({ key: "\\", mod: true });
	});

	test("Close tab shows the native Mod+W on desktop and the Mod+Alt+W alias in a browser", () => {
		expect(keybindingShortcut("tab.close")).toEqual({ key: "W", mod: true });
		expect(keybindingShortcut("tab.close", { browser: true })).toEqual({
			key: "W",
			mod: true,
			alt: true,
		});
		expect(keybindingLabel("tab.close", { platform: PLATFORMS.apple })).toBe("⌘W");
		expect(keybindingLabel("tab.close", { browser: true, platform: PLATFORMS.linux })).toBe(
			"Ctrl+Alt+W",
		);
	});

	test("a platform-scoped chord is shown only on its platform", () => {
		expect(keybindingShortcut("tab.moveToNextGroup", { platform: PLATFORMS.apple })).toEqual({
			key: "→",
			ctrl: true,
			mod: true,
		});
		expect(keybindingShortcut("tab.moveToNextGroup", { platform: PLATFORMS.windows })).toEqual({
			key: "→",
			ctrl: true,
			alt: true,
		});
		expect(keybindingLabel("tab.moveToPreviousGroup", { platform: PLATFORMS.apple })).toBe("⌃⌘←");
		expect(keybindingLabel("tab.moveToPreviousGroup", { platform: PLATFORMS.linux })).toBe(
			"Ctrl+Alt+←",
		);
		expect(keybindingLabels("tab.moveToNextGroup", PLATFORMS.apple)).toEqual(["⌃⌘→"]);
		expect(keybindingLabels("tab.moveToNextGroup", PLATFORMS.windows)).toEqual(["Ctrl+Alt+→"]);
	});

	test("New workspace shows Mod+N where the page receives it and Mod+Alt+N in a browser", () => {
		expect(keybindingShortcut("workspace.new")).toEqual({ key: "N", mod: true });
		expect(keybindingShortcut("workspace.new", { browser: true })).toEqual({
			key: "N",
			mod: true,
			alt: true,
		});
		expect(keybindingShortcut("view.toggleLeft", { browser: true })).toEqual({
			key: "B",
			mod: true,
		});
	});

	test("labels name a binding's chords the way chrome spells them", () => {
		expect(keybindingLabel("search.open", { platform: PLATFORMS.apple })).toBe("⌘K");
		expect(keybindingLabel("search.open", { platform: PLATFORMS.windows })).toBe("Ctrl+K");
		expect(keybindingLabel("chat.history", { platform: PLATFORMS.apple })).toBe("⌃R");
		expect(keybindingLabel("focus.terminal", { platform: PLATFORMS.apple })).toBe("⌃`");
		expect(keybindingLabel("focus.terminal", { platform: PLATFORMS.linux })).toBe("Ctrl+`");
		expect(keybindingLabel("region.previous", { platform: PLATFORMS.windows })).toBe("Shift+F6");
		expect(keybindingLabel("workspace.new", { browser: true, platform: PLATFORMS.linux })).toBe(
			"Ctrl+Alt+N",
		);
		expect(keybindingLabels("workspace.new", PLATFORMS.apple)).toEqual(["⌘N", "⌥⌘N"]);
		expect(keybindingLabels("workspace.new", PLATFORMS.windows)).toEqual(["Ctrl+N", "Ctrl+Alt+N"]);
	});
});
