import { describe, expect, test } from "bun:test";
import { panelHotkeyCommand } from "./useGlobalHotkeys";

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
