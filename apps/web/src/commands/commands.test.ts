import { describe, expect, test } from "bun:test";
import { RiAddLine } from "@remixicon/react";
import {
	type Command,
	type CommandContext,
	isCommandEnabled,
	isCommandVisible,
	shortcutKeys,
	shortcutLabel,
	visibleCommands,
} from ".";

const context: CommandContext = {
	online: true,
	projectId: "p1",
	workspaceId: null,
	protocolVersion: 86,
};

const command = (overrides: Partial<Command> = {}): Command => ({
	id: "test",
	title: "Test",
	group: "work",
	icon: RiAddLine,
	...overrides,
});

describe("command availability", () => {
	test("hides a command whose context check fails", () => {
		const needsWorkspace = command({ when: (ctx) => ctx.workspaceId !== null });
		expect(isCommandVisible(needsWorkspace, context)).toBe(false);
		expect(isCommandVisible(needsWorkspace, { ...context, workspaceId: "w1" })).toBe(true);
		expect(visibleCommands([needsWorkspace, command({ id: "always" })], context)).toHaveLength(1);
	});

	test("disables host mutations while offline but keeps local commands", () => {
		const offline = { ...context, online: false };
		expect(isCommandEnabled(command({ mutates: true }), offline)).toBe(false);
		expect(isCommandEnabled(command(), offline)).toBe(true);
		expect(isCommandEnabled(command({ mutates: true }), context)).toBe(true);
	});
});

describe("shortcut labels", () => {
	test("renders macOS glyphs in the system order", () => {
		expect(shortcutKeys({ key: "A", mod: true, alt: true }, "MacIntel")).toEqual(["⌥", "⌘", "A"]);
		expect(shortcutLabel({ key: "J", mod: true, shift: true }, "MacIntel")).toBe("⇧⌘J");
	});

	test("renders Ctrl chords elsewhere", () => {
		expect(shortcutLabel({ key: "N", mod: true }, "Win32")).toBe("Ctrl+N");
		expect(shortcutLabel({ key: "R", ctrl: true }, "Linux x86_64")).toBe("Ctrl+R");
		expect(shortcutLabel({ key: "J", mod: true, shift: true }, "Linux x86_64")).toBe(
			"Ctrl+Shift+J",
		);
	});
});
