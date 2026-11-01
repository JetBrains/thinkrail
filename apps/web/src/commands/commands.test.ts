import { describe, expect, test } from "bun:test";
import { RiAddLine } from "@remixicon/react";
import { type Command, isCommandEnabled, shortcutKeys } from ".";

const command = (overrides: Partial<Command> = {}): Command => ({
	id: "test",
	title: "Test",
	group: "work",
	icon: RiAddLine,
	run: () => {},
	...overrides,
});

describe("command availability", () => {
	test("disables host mutations while offline but keeps local commands", () => {
		expect(isCommandEnabled(command({ mutates: true }), false)).toBe(false);
		expect(isCommandEnabled(command(), false)).toBe(true);
		expect(isCommandEnabled(command({ mutates: true }), true)).toBe(true);
	});
});

describe("shortcut keys", () => {
	test("renders macOS glyphs in the system order", () => {
		expect(shortcutKeys({ key: "A", mod: true, alt: true }, "MacIntel")).toEqual(["⌥", "⌘", "A"]);
		expect(shortcutKeys({ key: "J", mod: true, shift: true }, "MacIntel")).toEqual(["⇧", "⌘", "J"]);
	});

	test("renders Ctrl chords elsewhere", () => {
		expect(shortcutKeys({ key: "N", mod: true }, "Win32")).toEqual(["Ctrl", "N"]);
		expect(shortcutKeys({ key: "R", ctrl: true }, "Linux x86_64")).toEqual(["Ctrl", "R"]);
		expect(shortcutKeys({ key: "J", mod: true, shift: true }, "Linux x86_64")).toEqual([
			"Ctrl",
			"Shift",
			"J",
		]);
	});
});
