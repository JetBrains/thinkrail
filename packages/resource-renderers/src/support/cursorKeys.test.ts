import { expect, test } from "bun:test";
import { ARROW_TWIN_COMMANDS } from "@thinkrail/ui/keyboard";
import { type LocalKeymap, localKeys } from "@thinkrail/ui/local-keys";
import { READING_COMMANDS } from "@thinkrail/ui/reading";
import {
	type CursorKeyEvent,
	composerSubmit,
	cursorCommand,
	REVIEW_SURFACE_COMMANDS,
	REVIEW_SURFACE_SCOPE,
	readingCursorKey,
} from "./cursorKeys";
import { READER_SCOPE } from "./readingSurface";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";
const DEFAULTS = [...REVIEW_SURFACE_COMMANDS, ...ARROW_TWIN_COMMANDS];

const keymap = (platform: string, scopes: LocalKeymap["scopes"] = new Map()): LocalKeymap => ({
	platform,
	scopes,
	isTextEntry: () => false,
});
const linux = localKeys(keymap(LINUX), REVIEW_SURFACE_SCOPE, DEFAULTS);
const mac = localKeys(keymap(MAC), REVIEW_SURFACE_SCOPE, DEFAULTS);

const LETTER_CODES: Readonly<Record<string, string>> = { m: "KeyM", v: "KeyV", n: "KeyN" };

const key = (
	value: string,
	modifiers: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {},
	code = /^[hjkl]$/i.test(value)
		? `Key${value.toUpperCase()}`
		: (LETTER_CODES[value.toLowerCase()] ?? value),
): CursorKeyEvent => ({
	key: value,
	code,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	isComposing: false,
	keyCode: 0,
	target: null,
	...modifiers,
});

test("arrows and the h/j/k/l twins move the cursor by physical key, Shift extends", () => {
	expect(cursorCommand(key("ArrowDown"), linux)).toEqual({
		kind: "move",
		direction: "down",
		extend: false,
	});
	expect(cursorCommand(key("j"), linux)).toEqual({
		kind: "move",
		direction: "down",
		extend: false,
	});
	expect(cursorCommand(key("о", {}, "KeyJ"), linux)).toEqual({
		kind: "move",
		direction: "down",
		extend: false,
	});
	expect(cursorCommand(key("K", { shiftKey: true }), linux)).toEqual({
		kind: "move",
		direction: "up",
		extend: true,
	});
	expect(cursorCommand(key("h"), linux)).toEqual({
		kind: "move",
		direction: "left",
		extend: false,
	});
	expect(cursorCommand(key("ArrowRight"), linux)).toEqual({
		kind: "move",
		direction: "right",
		extend: false,
	});
	expect(cursorCommand(key("End"), linux)).toEqual({ kind: "edge", edge: "last", extend: false });
	expect(cursorCommand(key("Escape"), linux)).toEqual({ kind: "escape" });
});

test("Enter or Shift+Mod+M comments; other chords pass through to their owners", () => {
	expect(cursorCommand(key("Enter"), linux)).toEqual({ kind: "comment" });
	expect(cursorCommand(key("M", { shiftKey: true, metaKey: true }), mac)).toEqual({
		kind: "comment",
	});
	expect(cursorCommand(key("M", { shiftKey: true, ctrlKey: true }), linux)).toEqual({
		kind: "comment",
	});
	expect(cursorCommand(key("M", { shiftKey: true, ctrlKey: true }), mac)).toBeNull();
	expect(cursorCommand(key("M", { ctrlKey: true }), linux)).toBeNull();
	expect(cursorCommand(key("Enter", { shiftKey: true }), linux)).toBeNull();
	expect(cursorCommand(key("ArrowDown", { altKey: true }), linux)).toBeNull();
	expect(cursorCommand(key("j", { ctrlKey: true }), linux)).toBeNull();
	expect(cursorCommand(key("v"), linux)).toBeNull();
	expect(cursorCommand(key("n"), linux)).toBeNull();
	expect(cursorCommand({ ...key("Enter"), isComposing: true }, linux)).toBeNull();
	expect(cursorCommand({ ...key("j"), keyCode: 229 }, linux)).toBeNull();
});

test("a rebound twin or comment chord replaces its default; the locked keys stay", () => {
	const rebound = localKeys(
		keymap(
			LINUX,
			new Map([
				[
					REVIEW_SURFACE_SCOPE,
					[
						{ id: "arrows.down", chord: { code: "KeyN", key: "N" } },
						{ id: "review.surface.comment", chord: { code: "KeyC", key: "C", alt: true } },
					],
				],
			]),
		),
		REVIEW_SURFACE_SCOPE,
		DEFAULTS,
	);
	expect(cursorCommand(key("n"), rebound)).toEqual({
		kind: "move",
		direction: "down",
		extend: false,
	});
	expect(cursorCommand(key("N", { shiftKey: true }), rebound)).toEqual({
		kind: "move",
		direction: "down",
		extend: true,
	});
	expect(cursorCommand(key("j"), rebound)).toBeNull();
	expect(cursorCommand(key("ArrowDown"), rebound)).toEqual({
		kind: "move",
		direction: "down",
		extend: false,
	});
	expect(cursorCommand(key("c", { altKey: true }, "KeyC"), rebound)).toEqual({ kind: "comment" });
	expect(cursorCommand(key("M", { shiftKey: true, ctrlKey: true }), rebound)).toBeNull();
	expect(cursorCommand(key("Enter"), rebound)).toEqual({ kind: "comment" });
});

test("an exact twin match wins; Shift extends only a shifted press of an unshifted twin", () => {
	const shifted = localKeys(
		keymap(
			LINUX,
			new Map([
				[
					REVIEW_SURFACE_SCOPE,
					[
						{ id: "arrows.down", chord: { code: "KeyK", key: "K", shift: true } },
						{ id: "arrows.up", chord: { code: "KeyK", key: "K" } },
						{ id: "arrows.left", chord: { code: "KeyH", key: "H" } },
					],
				],
			]),
		),
		REVIEW_SURFACE_SCOPE,
		DEFAULTS,
	);
	expect(shifted.match(key("k"))).toBe("arrows.up");
	expect(cursorCommand(key("k"), shifted)).toEqual({
		kind: "move",
		direction: "up",
		extend: false,
	});
	expect(cursorCommand(key("K", { shiftKey: true }), shifted)).toEqual({
		kind: "move",
		direction: "down",
		extend: false,
	});
	expect(cursorCommand(key("H", { shiftKey: true }), shifted)).toEqual({
		kind: "move",
		direction: "left",
		extend: true,
	});
	expect(cursorCommand(key("ArrowDown", { shiftKey: true }), shifted)).toEqual({
		kind: "move",
		direction: "down",
		extend: true,
	});
	const shiftOnly = localKeys(
		keymap(
			LINUX,
			new Map([
				[
					REVIEW_SURFACE_SCOPE,
					[{ id: "arrows.down", chord: { code: "KeyK", key: "K", shift: true } }],
				],
			]),
		),
		REVIEW_SURFACE_SCOPE,
		DEFAULTS,
	);
	expect(cursorCommand(key("k"), shiftOnly)).toBeNull();
});

test("a local command the surface does not own passes its chord through", () => {
	const rebound = localKeys(
		keymap(
			LINUX,
			new Map([
				[
					REVIEW_SURFACE_SCOPE,
					[{ id: "review.surface.saveDraft", chord: { code: "Enter", key: "↵", alt: true } }],
				],
			]),
		),
		REVIEW_SURFACE_SCOPE,
		DEFAULTS,
	);
	expect(cursorCommand(key("Enter", { altKey: true }), rebound)).toBeNull();
	expect(composerSubmit(key("Enter", { altKey: true }), rebound)).toBe("save");
});

const READER_DEFAULTS = [...ARROW_TWIN_COMMANDS, ...READING_COMMANDS];
const reader = localKeys(keymap(LINUX), READER_SCOPE, READER_DEFAULTS);

const readerWith = (
	...chords: [string, { code: string; key: string; shift?: true; mod?: true }][]
) =>
	localKeys(
		keymap(
			LINUX,
			new Map([
				[
					READER_SCOPE,
					[
						...ARROW_TWIN_COMMANDS.map(({ id, chords: [chord] }) => ({ id, chord })),
						...chords.map(([id, chord]) => ({ id, chord })),
					],
				],
			]),
		),
		READER_SCOPE,
		READER_DEFAULTS,
	);

test("the block cursor reads plain walks and extends a shifted twin", () => {
	const press = (event: CursorKeyEvent) => readingCursorKey(event, linux, reader);
	expect(press(key("j"))).toEqual({ kind: "reading", command: { kind: "line", direction: 1 } });
	expect(press(key("ArrowUp"))).toEqual({
		kind: "reading",
		command: { kind: "line", direction: -1 },
	});
	expect(press(key(" "))).toEqual({ kind: "reading", command: { kind: "page", direction: 1 } });
	expect(press(key("G", { shiftKey: true }, "KeyG"))).toEqual({
		kind: "reading",
		command: { kind: "edge", direction: 1 },
	});
	expect(press(key("J", { shiftKey: true }))).toEqual({
		kind: "cursor",
		command: { kind: "move", direction: "down", extend: true },
	});
	expect(press(key("End", { shiftKey: true }))).toEqual({
		kind: "cursor",
		command: { kind: "edge", edge: "last", extend: true },
	});
	expect(press(key("Enter"))).toEqual({ kind: "cursor", command: { kind: "comment" } });
	expect(press(key("Escape"))).toEqual({ kind: "cursor", command: { kind: "escape" } });
	expect(press(key("v"))).toBeNull();
});

test("an exact reader key wins over a shifted twin's extension; the review actions keep theirs", () => {
	const rebound = readerWith(
		["reading.top", { code: "KeyM", key: "M", shift: true, mod: true }],
		["reading.bottom", { code: "KeyJ", key: "J", shift: true }],
	);
	const press = (event: CursorKeyEvent) => readingCursorKey(event, linux, rebound);
	expect(press(key("J", { shiftKey: true }))).toEqual({
		kind: "reading",
		command: { kind: "edge", direction: 1 },
	});
	expect(press(key("K", { shiftKey: true }))).toEqual({
		kind: "cursor",
		command: { kind: "move", direction: "up", extend: true },
	});
	expect(press(key("G", { shiftKey: true }, "KeyG"))).toBeNull();
	expect(press(key("M", { shiftKey: true, ctrlKey: true }))).toEqual({
		kind: "cursor",
		command: { kind: "comment" },
	});
	expect(press({ ...key("J", { shiftKey: true }), isComposing: true })).toBeNull();
});

test("the composer saves on Mod+Enter and sends on Shift+Mod+Enter", () => {
	expect(composerSubmit(key("Enter", { ctrlKey: true }), linux)).toBe("save");
	expect(composerSubmit(key("Enter", { metaKey: true }), mac)).toBe("save");
	expect(composerSubmit(key("Enter", { metaKey: true, shiftKey: true }), mac)).toBe("send");
	expect(composerSubmit(key("Enter", { ctrlKey: true, shiftKey: true }), linux)).toBe("send");
	expect(composerSubmit(key("Enter", { ctrlKey: true }, "NumpadEnter"), linux)).toBe("save");
	expect(composerSubmit(key("Enter", { metaKey: true, shiftKey: true }, "NumpadEnter"), mac)).toBe(
		"send",
	);
	expect(composerSubmit(key("Enter"), linux)).toBeNull();
	expect(composerSubmit(key("Enter", { shiftKey: true }), linux)).toBeNull();
});
