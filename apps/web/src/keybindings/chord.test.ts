import { describe, expect, test } from "bun:test";
import {
	chordFromEvent,
	formatChord,
	isBrowserReservedChord,
	isDesktopNativeChord,
	isLockedPrimitive,
	isPlainChord,
	KEYBINDINGS,
	parseChord,
} from ".";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";
const WINDOWS = "Win32";

type Modifiers = Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>>;

const press = (code: string, modifiers: Modifiers = {}, altGraph = false) => ({
	code,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
	getModifierState: (key: string) => altGraph && key === "AltGraph",
});

describe("the chord grammar", () => {
	test("parses a chord into a physical key chord and formats it back unchanged", () => {
		for (const text of [
			"Mod+Alt+KeyS",
			"Ctrl+Alt+ArrowLeft",
			"F6",
			"Shift+F6",
			"Mod+Semicolon",
			"Mod+Backslash",
			"Mod+Ctrl+Shift+Digit1",
			"KeyF",
		]) {
			const chord = parseChord(text);
			expect(chord).not.toBeNull();
			expect(chord && formatChord(chord)).toBe(text);
		}
	});

	test("labels the key from its code the way the table spells it", () => {
		expect(parseChord("Mod+Alt+KeyS")).toEqual({ code: "KeyS", key: "S", mod: true, alt: true });
		expect(parseChord("Ctrl+Alt+ArrowLeft")).toEqual({
			code: "ArrowLeft",
			key: "←",
			ctrl: true,
			alt: true,
		});
		expect(parseChord("Mod+Backslash")).toEqual({ code: "Backslash", key: "\\", mod: true });
		expect(parseChord("Mod+Semicolon")?.key).toBe(";");
		expect(parseChord("Mod+Digit0")?.key).toBe("0");
		expect(parseChord("Mod+Numpad0")?.key).toBe("Num 0");
		expect(parseChord("Ctrl+Backquote")?.key).toBe("`");
		expect(parseChord("Mod+Space")?.key).toBe("Space");
		expect(parseChord("Mod+Enter")?.key).toBe("↵");
		expect(parseChord("F6")).toEqual({ code: "F6", key: "F6" });
	});

	test("rejects a chord outside the grammar instead of guessing", () => {
		for (const text of ["Alt+Mod+KeyS", "Mod+s", "Cmd+KeyS", "Mod+ShiftLeft", "", "Mod+"]) {
			expect([text, parseChord(text)]).toEqual([text, null]);
		}
	});

	test("orders modifiers canonically whatever order the fields were set in", () => {
		expect(formatChord({ code: "KeyK", shift: true, alt: true, ctrl: true, mod: true })).toBe(
			"Mod+Ctrl+Alt+Shift+KeyK",
		);
		expect(formatChord({ code: "KeyK", mod: false, shift: true })).toBe("Shift+KeyK");
	});

	test("a plain chord has no Mod, Ctrl or Alt and is not F1–F12", () => {
		const plain = (text: string) => isPlainChord(parseChord(text) ?? { code: "", key: "" });
		expect(plain("KeyF")).toBe(true);
		expect(plain("Shift+KeyF")).toBe(true);
		expect(plain("F13")).toBe(true);
		expect(plain("F6")).toBe(false);
		expect(plain("Shift+F12")).toBe(false);
		expect(plain("Alt+KeyF")).toBe(false);
		expect(plain("Ctrl+KeyF")).toBe(false);
		expect(plain("Mod+KeyF")).toBe(false);
	});
});

describe("chordFromEvent", () => {
	test("records ⌘ as Mod and ⌃ as Ctrl on Apple", () => {
		expect(chordFromEvent(press("KeyS", { metaKey: true, altKey: true }), MAC)).toEqual({
			kind: "chord",
			chord: "Mod+Alt+KeyS",
			browserReserved: false,
		});
		expect(chordFromEvent(press("ArrowLeft", { ctrlKey: true, metaKey: true }), MAC)).toEqual({
			kind: "chord",
			chord: "Mod+Ctrl+ArrowLeft",
			browserReserved: false,
		});
		expect(chordFromEvent(press("KeyR", { ctrlKey: true }), MAC)).toEqual({
			kind: "chord",
			chord: "Ctrl+KeyR",
			browserReserved: false,
		});
	});

	test("records Control as Mod elsewhere and ignores the Windows key", () => {
		for (const platform of [LINUX, WINDOWS]) {
			expect(chordFromEvent(press("KeyS", { ctrlKey: true, altKey: true }), platform)).toEqual({
				kind: "chord",
				chord: "Mod+Alt+KeyS",
				browserReserved: false,
			});
			expect(chordFromEvent(press("KeyS", { metaKey: true }), platform)).toEqual({
				kind: "ignored",
			});
		}
	});

	test("records by physical code, so a Cyrillic layout records the same chord", () => {
		const cyrillic = { ...press("Semicolon", { ctrlKey: true }), key: "ж" };
		expect(chordFromEvent(cyrillic, LINUX)).toMatchObject({ chord: "Mod+Semicolon" });
	});

	test("ignores an AltGraph press off Apple, where it is a typed character", () => {
		const altGr = press("KeyQ", { ctrlKey: true, altKey: true }, true);
		expect(chordFromEvent(altGr, WINDOWS)).toEqual({ kind: "ignored" });
		expect(chordFromEvent(altGr, LINUX)).toEqual({ kind: "ignored" });
		expect(chordFromEvent(press("KeyQ", { altKey: true }, true), MAC)).toEqual({
			kind: "chord",
			chord: "Alt+KeyQ",
			browserReserved: false,
		});
	});

	test("rejects a modifier on its own and a plain key unless the command allows plain keys", () => {
		for (const code of ["ShiftLeft", "ControlRight", "MetaLeft", "AltLeft"]) {
			expect(chordFromEvent(press(code, { shiftKey: true }), LINUX)).toEqual({
				kind: "rejected",
				reason: "modifierOnly",
			});
		}
		expect(chordFromEvent(press("KeyG"), LINUX)).toEqual({ kind: "rejected", reason: "plain" });
		expect(chordFromEvent(press("KeyG", { shiftKey: true }), MAC)).toEqual({
			kind: "rejected",
			reason: "plain",
		});
		expect(chordFromEvent(press("KeyG"), LINUX, { allowPlain: true })).toEqual({
			kind: "chord",
			chord: "KeyG",
			browserReserved: false,
		});
		expect(chordFromEvent(press("F6"), LINUX)).toEqual({
			kind: "chord",
			chord: "F6",
			browserReserved: false,
		});
		expect(chordFromEvent(press("F13"), LINUX)).toEqual({ kind: "rejected", reason: "plain" });
		expect(chordFromEvent(press(""), LINUX)).toEqual({ kind: "ignored" });
	});

	test("flags the chords browsers keep as a warning, never a rejection", () => {
		const reserved = (code: string, modifiers: Modifiers, platform: string) =>
			chordFromEvent(press(code, modifiers), platform);
		for (const [code, shift] of [
			["KeyT", false],
			["KeyN", false],
			["KeyW", false],
			["KeyQ", false],
			["Tab", false],
			["KeyT", true],
			["KeyN", true],
			["KeyW", true],
		] as const) {
			expect(reserved(code, { metaKey: true, shiftKey: shift }, MAC)).toMatchObject({
				kind: "chord",
				browserReserved: true,
			});
			expect(reserved(code, { ctrlKey: true, shiftKey: shift }, LINUX)).toMatchObject({
				kind: "chord",
				browserReserved: true,
			});
		}
		expect(reserved("KeyT", { ctrlKey: true }, MAC)).toMatchObject({ browserReserved: false });
		expect(reserved("KeyT", { ctrlKey: true, altKey: true }, LINUX)).toMatchObject({
			browserReserved: false,
		});
		expect(reserved("KeyK", { ctrlKey: true }, LINUX)).toMatchObject({ browserReserved: false });
		expect(isBrowserReservedChord("Ctrl+KeyT", LINUX)).toBe(true);
		expect(isBrowserReservedChord("Ctrl+KeyT", MAC)).toBe(false);
		for (const platform of [MAC, LINUX]) {
			expect(isBrowserReservedChord("Ctrl+Tab", platform)).toBe(true);
			expect(isBrowserReservedChord("Ctrl+Shift+Tab", platform)).toBe(true);
		}
	});
});

test("the desktop app's own chords are native on the OS that owns them, under either modifier name", () => {
	for (const chord of ["Mod+KeyW", "Mod+KeyQ", "Mod+Comma", "Mod+F4", "Mod+Equal", "Mod+Minus"]) {
		expect(isDesktopNativeChord(chord)).toBe(true);
	}
	expect(isDesktopNativeChord("Ctrl+KeyW")).toBe(true);
	expect(isDesktopNativeChord("Mod+KeyH")).toBe(true);
	expect(isDesktopNativeChord("Mod+Shift+KeyW")).toBe(false);
	expect(isDesktopNativeChord("Mod+Alt+KeyW")).toBe(false);
	expect(isDesktopNativeChord("Mod+Digit0")).toBe(false);
	expect(isDesktopNativeChord("Mod+Shift+Space")).toBe(false);
	expect(isDesktopNativeChord("not a chord")).toBe(false);
	const matchable = Object.values(KEYBINDINGS).flatMap((chords) =>
		chords.filter((chord) => !chord.displayOnly && isDesktopNativeChord(chord)),
	);
	expect(matchable).toEqual([]);
});

test("navigation primitives with no modifier or Shift alone are locked; a recorder refuses them", () => {
	for (const chord of [
		"ArrowDown",
		"Shift+ArrowLeft",
		"Enter",
		"Shift+Enter",
		"Escape",
		"Shift+Escape",
		"Tab",
		"Shift+Tab",
		"Space",
		"Home",
		"End",
		"PageUp",
		"PageDown",
	]) {
		expect([chord, isLockedPrimitive(chord)]).toEqual([chord, true]);
	}
	for (const chord of [
		"Mod+Enter",
		"Alt+Enter",
		"Mod+Shift+Enter",
		"Alt+Shift+ArrowUp",
		"Mod+ArrowUp",
		"KeyJ",
		"Delete",
		"F2",
	]) {
		expect([chord, isLockedPrimitive(chord)]).toEqual([chord, false]);
	}
	expect(chordFromEvent(press("ArrowDown"), LINUX, { allowPlain: true })).toEqual({
		kind: "rejected",
		reason: "locked",
		chord: "ArrowDown",
	});
	expect(chordFromEvent(press("Escape", { shiftKey: true }), LINUX, { allowPlain: true })).toEqual({
		kind: "rejected",
		reason: "locked",
		chord: "Shift+Escape",
	});
	expect(
		chordFromEvent(press("ArrowDown"), LINUX, { allowPlain: true, allowLocked: true }),
	).toMatchObject({ kind: "chord", chord: "ArrowDown" });
	expect(chordFromEvent(press("Enter", { ctrlKey: true }), LINUX)).toMatchObject({
		kind: "chord",
		chord: "Mod+Enter",
	});
	expect(chordFromEvent(press("KeyJ"), LINUX, { allowPlain: true })).toMatchObject({
		kind: "chord",
		chord: "KeyJ",
	});
});
