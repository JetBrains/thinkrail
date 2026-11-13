import { describe, expect, test } from "bun:test";
import {
	KEYBINDINGS,
	type KeybindingId,
	keybindingLabel,
	keybindingLabels,
	keybindingShortcut,
	matchKeybinding,
} from ".";

type Modifiers = Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>>;

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

	test("Mod+K rejects Shift and Alt, and only Mod+N accepts Alt", () => {
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

test("Ctrl+R is literal Control on Apple, where Cmd+R stays the browser's", () => {
	expect(matchKeybinding(press("KeyR", { ctrlKey: true }), PLATFORMS.apple)).toBe("chat.history");
	expect(matchKeybinding(press("KeyR", { metaKey: true }), PLATFORMS.apple)).toBeNull();
	expect(matchKeybinding(press("KeyB", { ctrlKey: true }), PLATFORMS.apple)).toBeNull();
});

test("every chord resolves to its own binding and no two bindings share a chord on a platform", () => {
	for (const platform of Object.values(PLATFORMS)) {
		const apple = platform === PLATFORMS.apple;
		const owners = new Map<string, KeybindingId>();
		for (const [id, chords] of entries) {
			for (const chord of chords) {
				const event = press(chord.code, {
					ctrlKey: chord.ctrl === true || (chord.mod === true && !apple),
					metaKey: chord.mod === true && apple,
					shiftKey: chord.shift === true,
					altKey: chord.alt === true,
				});
				const signature = JSON.stringify(event);
				expect(owners.get(signature) ?? id).toBe(id);
				owners.set(signature, id);
				expect(matchKeybinding(event, platform)).toBe(id);
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
		expect(keybindingLabel("workspace.new", { browser: true, platform: PLATFORMS.linux })).toBe(
			"Ctrl+Alt+N",
		);
		expect(keybindingLabels("workspace.new", PLATFORMS.apple)).toEqual(["⌘N", "⌥⌘N"]);
		expect(keybindingLabels("workspace.new", PLATFORMS.windows)).toEqual(["Ctrl+N", "Ctrl+Alt+N"]);
	});
});
