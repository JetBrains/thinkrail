import { expect, test } from "bun:test";
import { ARROW_TWIN_COMMANDS } from "@thinkrail/ui/keyboard";
import { type LocalKeymap, localKeys } from "@thinkrail/ui/local-keys";
import {
	type CursorKeyEvent,
	composerSubmit,
	cursorCommand,
	REVIEW_SURFACE_COMMANDS,
	REVIEW_SURFACE_SCOPE,
} from "./cursorKeys";

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
