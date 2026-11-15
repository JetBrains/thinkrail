import { expect, test } from "bun:test";
import { KEYBINDINGS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { keybindingLabel } from "../keybindings";
import { selectKeybindings } from "./keybindingState";

const overrides = { "search.open": ["Mod+Alt+KeyS"] };

test("an older host's stored overrides are ignored: the client runs the defaults", () => {
	const older = selectKeybindings({
		protocolVersion: KEYBINDINGS_PROTOCOL_VERSION - 1,
		keybindingOverrides: overrides,
		disabledExtensions: [],
	});
	expect(keybindingLabel(older, "search.open")).toBe("Ctrl+K");
	const current = selectKeybindings({
		protocolVersion: KEYBINDINGS_PROTOCOL_VERSION,
		keybindingOverrides: overrides,
		disabledExtensions: [],
	});
	expect(keybindingLabel(current, "search.open")).toBe("Ctrl+Alt+S");
});

test("resolves once per change of overrides or switched-off extensions", () => {
	const disabled: string[] = [];
	const state = {
		protocolVersion: KEYBINDINGS_PROTOCOL_VERSION,
		keybindingOverrides: overrides,
		disabledExtensions: disabled,
	};
	const first = selectKeybindings(state);
	expect(selectKeybindings({ ...state })).toBe(first);
	expect(first.byId.get("hint-mode.show")?.enabled).toBe(true);
	const off = selectKeybindings({ ...state, disabledExtensions: ["hint-mode"] });
	expect(off).not.toBe(first);
	expect(off.byId.get("hint-mode.show")?.enabled).toBe(false);
	expect(selectKeybindings({ ...state, keybindingOverrides: {} })).not.toBe(off);
});
