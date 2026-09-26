import { describe, expect, test } from "bun:test";
import { globalHotkeyCommand } from "./useGlobalHotkeys";

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

const all = { projects: true, workspace: true, bottom: true, newWorkspace: true } as const;

describe("global hotkey routing", () => {
	test("keeps the existing physical-key chords and adds Mod+Shift+J for bottom", () => {
		expect(globalHotkeyCommand(key("KeyB"), all, false, "Linux")).toBe("projects");
		expect(globalHotkeyCommand(key("KeyJ"), all, false, "Linux")).toBe("workspace");
		expect(globalHotkeyCommand(key("KeyJ", { shiftKey: true }), all, false, "Linux")).toBe(
			"bottom",
		);
		expect(
			globalHotkeyCommand(
				key("KeyJ", { ctrlKey: false, metaKey: true, shiftKey: true }),
				all,
				false,
				"MacIntel",
			),
		).toBe("bottom");
		expect(globalHotkeyCommand(key("KeyK", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyB", { altKey: true }), all, false, "Linux")).toBeNull();
	});

	test("routes Mod+N and the Mod+Alt+N alias to new-workspace, never with Shift, never when unavailable or behind a modal", () => {
		expect(globalHotkeyCommand(key("KeyN"), all, false, "Linux")).toBe("new-workspace");
		expect(
			globalHotkeyCommand(key("KeyN", { ctrlKey: false, metaKey: true }), all, false, "MacIntel"),
		).toBe("new-workspace");
		expect(globalHotkeyCommand(key("KeyN", { altKey: true }), all, false, "Linux")).toBe(
			"new-workspace",
		);
		expect(
			globalHotkeyCommand(
				key("KeyN", { ctrlKey: false, metaKey: true, altKey: true }),
				all,
				false,
				"MacIntel",
			),
		).toBe("new-workspace");
		expect(globalHotkeyCommand(key("KeyN", { shiftKey: true }), all, false, "Linux")).toBeNull();
		expect(
			globalHotkeyCommand(key("KeyN"), { ...all, newWorkspace: false }, false, "Linux"),
		).toBeNull();
		expect(globalHotkeyCommand(key("KeyN"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyN", { metaKey: false }), all, false, "MacIntel")).toBeNull();
	});

	test("does not claim unavailable workspace commands or any panel chord behind a modal", () => {
		expect(
			globalHotkeyCommand(
				key("KeyJ", { shiftKey: true }),
				{ projects: true, workspace: false, bottom: false, newWorkspace: false },
				false,
				"Linux",
			),
		).toBeNull();
		expect(globalHotkeyCommand(key("KeyB"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyJ"), all, true, "Linux")).toBeNull();
		expect(globalHotkeyCommand(key("KeyJ", { shiftKey: true }), all, true, "Linux")).toBeNull();
	});
});
