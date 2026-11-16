import { describe, expect, test } from "bun:test";
import { ARROW_TWIN_COMMANDS } from "./keyboard";
import { type LocalKeyEvent, type LocalKeymap, localKeys } from "./local-keys";

const TREE = [
	{ id: "trees.search", chords: [{ code: "KeyS", key: "s" }] },
	{ id: "trees.openKept", chords: [{ code: "Enter", key: "↵", mod: true }] },
	...ARROW_TWIN_COMMANDS,
];

const row = Object.assign(new EventTarget(), { tagName: "DIV" });
const field = Object.assign(new EventTarget(), { tagName: "INPUT" });

const press = (code: string, init: Partial<LocalKeyEvent> = {}): LocalKeyEvent => ({
	code,
	key: "",
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	isComposing: false,
	keyCode: 0,
	target: row,
	...init,
});

const keymap = (scopes: LocalKeymap["scopes"]): LocalKeymap => ({
	platform: "Linux x86_64",
	scopes,
	isTextEntry: (target) => target === field,
});

describe("localKeys", () => {
	test("with no provider it matches the defaults by physical key, a Russian layout included", () => {
		const keys = localKeys(null, "trees", TREE);
		expect(keys.match(press("KeyS", { key: "ы" }))).toBe("trees.search");
		expect(keys.match(press("KeyJ", { key: "о" }))).toBe("arrows.down");
		expect(keys.match(press("KeyS", { key: "s", shiftKey: true }))).toBeNull();
		expect(keys.match(press("KeyS", { shiftKey: true }), { ignoreShift: true })).toBe(
			"trees.search",
		);
		expect(keys.caps("trees.search")).toEqual(["S"]);
	});

	test("the provider's effective chords replace the defaults; a scope it lacks keeps them", () => {
		const rebound = keymap(
			new Map([["trees", [{ id: "trees.search", chord: { code: "KeyF", key: "F" } }]]]),
		);
		const keys = localKeys(rebound, "trees", TREE);
		expect(keys.match(press("KeyF"))).toBe("trees.search");
		expect(keys.match(press("KeyS"))).toBeNull();
		expect(keys.match(press("KeyJ"))).toBeNull();
		expect(keys.caps("trees.search")).toEqual(["F"]);
		expect(keys.caps("trees.openKept")).toEqual([]);
		expect(keys.aria("trees.openKept")).toBeUndefined();
		expect(localKeys(rebound, "other", TREE).match(press("KeyS"))).toBe("trees.search");
	});

	test("an IME composition never matches, and a typing chord never matches in text entry", () => {
		const keys = localKeys(keymap(new Map()), "trees", TREE);
		expect(keys.match(press("KeyS", { isComposing: true }))).toBeNull();
		expect(keys.match(press("KeyS", { keyCode: 229 }))).toBeNull();
		const inField = { target: field };
		expect(keys.match(press("KeyS", inField))).toBeNull();
		expect(keys.match(press("Enter", { ...inField, ctrlKey: true }))).toBe("trees.openKept");
		expect(keys.match(press("KeyS", inField), { textEntry: false })).toBe("trees.search");
		expect(keys.match(press("KeyS"), { textEntry: true })).toBeNull();
	});

	test("ignoreShift prefers an exact match and relaxes Shift only for a chord that does not require it", () => {
		const shiftDown = { id: "arrows.down", chord: { code: "KeyK", key: "K", shift: true } };
		const plainUp = { id: "arrows.up", chord: { code: "KeyK", key: "K" } };
		for (const order of [
			[shiftDown, plainUp],
			[plainUp, shiftDown],
		]) {
			const keys = localKeys(keymap(new Map([["trees", order]])), "trees", TREE);
			expect(keys.match(press("KeyK"), { ignoreShift: true })).toBe("arrows.up");
			expect(keys.match(press("KeyK", { shiftKey: true }), { ignoreShift: true })).toBe(
				"arrows.down",
			);
		}
		const shiftOnly = localKeys(keymap(new Map([["trees", [shiftDown]]])), "trees", TREE);
		expect(shiftOnly.match(press("KeyK"), { ignoreShift: true })).toBeNull();
		const plainOnly = localKeys(keymap(new Map([["trees", [plainUp]]])), "trees", TREE);
		expect(plainOnly.match(press("KeyK", { shiftKey: true }))).toBeNull();
		expect(plainOnly.match(press("KeyK", { shiftKey: true }), { ignoreShift: true })).toBe(
			"arrows.up",
		);
	});

	test("aria lists every chord of the command for this platform only", () => {
		const mac = localKeys({ ...keymap(new Map()), platform: "MacIntel" }, "trees", TREE);
		expect(mac.aria("trees.openKept")).toBe("Meta+Enter");
		expect(mac.caps("trees.openKept")).toEqual(["⌘", "↵"]);
		expect(mac.label("trees.openKept")).toBe("⌘↵");
		const linux = localKeys(keymap(new Map()), "trees", TREE);
		expect(linux.aria("trees.openKept")).toBe("Control+Enter");
		expect(linux.label("trees.openKept")).toBe("Ctrl+↵");
		expect(linux.aria("arrows.left", "trees.openKept", "trees.missing")).toBe("H Control+Enter");
		expect(linux.aria("trees.missing")).toBeUndefined();
		expect(linux.label("trees.missing")).toBe("");
	});
});
