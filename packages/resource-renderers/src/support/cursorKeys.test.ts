import { expect, test } from "bun:test";
import { composerSubmit, cursorCommand } from "./cursorKeys";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";

const key = (
	value: string,
	modifiers: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {},
) => ({
	key: value,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	isComposing: false,
	keyCode: 0,
	...modifiers,
});

test("arrows and h/j/k/l move the cursor, Shift extends", () => {
	expect(cursorCommand(key("ArrowDown"))).toEqual({
		kind: "move",
		direction: "down",
		extend: false,
	});
	expect(cursorCommand(key("j"))).toEqual({ kind: "move", direction: "down", extend: false });
	expect(cursorCommand(key("K", { shiftKey: true }))).toEqual({
		kind: "move",
		direction: "up",
		extend: true,
	});
	expect(cursorCommand(key("h"))).toEqual({ kind: "move", direction: "left", extend: false });
	expect(cursorCommand(key("ArrowRight"))).toEqual({
		kind: "move",
		direction: "right",
		extend: false,
	});
	expect(cursorCommand(key("End"))).toEqual({ kind: "edge", edge: "last", extend: false });
	expect(cursorCommand(key("Escape"))).toEqual({ kind: "escape" });
});

test("Enter or Shift+Mod+M comments; other chords pass through to their owners", () => {
	expect(cursorCommand(key("Enter"))).toEqual({ kind: "comment" });
	expect(cursorCommand(key("M", { shiftKey: true, metaKey: true }), MAC)).toEqual({
		kind: "comment",
	});
	expect(cursorCommand(key("M", { shiftKey: true, ctrlKey: true }), LINUX)).toEqual({
		kind: "comment",
	});
	expect(cursorCommand(key("M", { shiftKey: true, ctrlKey: true }), MAC)).toBeNull();
	expect(cursorCommand(key("Enter", { shiftKey: true }))).toBeNull();
	expect(cursorCommand(key("ArrowDown", { altKey: true }))).toBeNull();
	expect(cursorCommand(key("j", { ctrlKey: true }))).toBeNull();
	expect(cursorCommand(key("v"))).toBeNull();
	expect(cursorCommand(key("n"))).toBeNull();
	expect(cursorCommand({ ...key("Enter"), isComposing: true })).toBeNull();
	expect(cursorCommand({ ...key("j"), keyCode: 229 })).toBeNull();
});

test("the composer saves on Mod+Enter and sends on Shift+Mod+Enter", () => {
	expect(composerSubmit(key("Enter", { ctrlKey: true }))).toBe("save");
	expect(composerSubmit(key("Enter", { metaKey: true }))).toBe("save");
	expect(composerSubmit(key("Enter", { metaKey: true, shiftKey: true }))).toBe("send");
	expect(composerSubmit(key("Enter"))).toBeNull();
	expect(composerSubmit(key("Enter", { shiftKey: true }))).toBeNull();
});
