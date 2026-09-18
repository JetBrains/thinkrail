import { describe, expect, test } from "bun:test";
import { attentionHotkeyCommand, panelHotkeyCommand } from "./useGlobalHotkeys";

const key = (
	code: string,
	overrides: Partial<{
		ctrlKey: boolean;
		metaKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
	}> = {},
) => ({
	code,
	ctrlKey: true,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	...overrides,
});

const all = { projects: true, workspace: true, bottom: true } as const;

const attentionKey = (
	overrides: Partial<{
		code: string;
		ctrlKey: boolean;
		metaKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
		repeat: boolean;
	}> = {},
) => ({
	code: "F8",
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	shiftKey: false,
	repeat: false,
	...overrides,
});

describe("attention hotkey routing", () => {
	test("F8 moves next and Shift+F8 moves previous without a text-focus exception", () => {
		expect(attentionHotkeyCommand(attentionKey(), true, false)).toEqual({
			direction: "next",
			invoke: true,
		});
		expect(attentionHotkeyCommand(attentionKey({ shiftKey: true }), true, false)).toEqual({
			direction: "previous",
			invoke: true,
		});
	});

	test("modded, unavailable, and modal F8 gestures remain unclaimed", () => {
		expect(attentionHotkeyCommand(attentionKey({ ctrlKey: true }), true, false)).toBeNull();
		expect(attentionHotkeyCommand(attentionKey({ metaKey: true }), true, false)).toBeNull();
		expect(attentionHotkeyCommand(attentionKey({ altKey: true }), true, false)).toBeNull();
		expect(attentionHotkeyCommand(attentionKey({ code: "F7" }), true, false)).toBeNull();
		expect(attentionHotkeyCommand(attentionKey(), false, false)).toBeNull();
		expect(attentionHotkeyCommand(attentionKey(), true, true)).toBeNull();
	});

	test("auto-repeat stays claimed but cannot advance the cycle", () => {
		expect(attentionHotkeyCommand(attentionKey({ repeat: true }), true, false)).toEqual({
			direction: "next",
			invoke: false,
		});
	});
});

describe("panel hotkey routing", () => {
	test("keeps the existing physical-key chords and adds Mod+Shift+J for bottom", () => {
		expect(panelHotkeyCommand(key("KeyB"), all, false, "Linux")).toBe("projects");
		expect(panelHotkeyCommand(key("KeyJ"), all, false, "Linux")).toBe("workspace");
		expect(panelHotkeyCommand(key("KeyJ", { shiftKey: true }), all, false, "Linux")).toBe("bottom");
		expect(
			panelHotkeyCommand(
				key("KeyJ", { ctrlKey: false, metaKey: true, shiftKey: true }),
				all,
				false,
				"MacIntel",
			),
		).toBe("bottom");
		expect(panelHotkeyCommand(key("KeyK", { shiftKey: true }), all, false, "Linux")).toBeNull();
	});

	test("does not claim unavailable workspace commands or any panel chord behind a modal", () => {
		expect(
			panelHotkeyCommand(
				key("KeyJ", { shiftKey: true }),
				{ projects: true, workspace: false, bottom: false },
				false,
				"Linux",
			),
		).toBeNull();
		expect(panelHotkeyCommand(key("KeyB"), all, true, "Linux")).toBeNull();
		expect(panelHotkeyCommand(key("KeyJ"), all, true, "Linux")).toBeNull();
		expect(panelHotkeyCommand(key("KeyJ", { shiftKey: true }), all, true, "Linux")).toBeNull();
	});
});
