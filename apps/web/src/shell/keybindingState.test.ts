import { expect, test } from "bun:test";
import { KEYBINDINGS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { keybindingLabel, keybindingList, resolveKeybindings } from "../keybindings";
import { commandTitle, selectKeybindings } from "./keybindingState";

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

test("a winner the browser's list lacks, a desktop row, is still named by its catalog title", () => {
	const keybindings = resolveKeybindings({
		platform: "Linux x86_64",
		overrides: { "search.open": ["Mod+KeyQ"] },
	});
	const list = keybindingList({ desktop: false, keybindings, extensions: [] });
	const winner = keybindings.byId.get("search.open")?.chords[0]?.lostTo ?? "";
	expect(commandTitle(currentTranslator(), list, winner)).toBe("Quit Helios");
	expect(commandTitle(currentTranslator(), list, "tab.close")).toBe("Close tab");
	expect(commandTitle(currentTranslator(), list, "retired.command")).toBe("retired.command");
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
