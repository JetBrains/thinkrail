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
	});

	test("aria lists every chord of the command for this platform only", () => {
		const mac = localKeys({ ...keymap(new Map()), platform: "MacIntel" }, "trees", TREE);
		expect(mac.aria("trees.openKept")).toBe("Meta+Enter");
		expect(mac.caps("trees.openKept")).toEqual(["⌘", "↵"]);
		expect(localKeys(keymap(new Map()), "trees", TREE).aria("trees.openKept")).toBe(
			"Control+Enter",
		);
	});
});
