import { expect, test } from "bun:test";
import { KEYBINDINGS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { currentTranslator } from "@thinkrail/locales/react";
import { REVIEW_SURFACE_COMMANDS } from "@thinkrail/resource-renderers";
import {
	keybindingLabel,
	keybindingList,
	resolveKeybindings,
	SHORTCUT_CATALOG,
	shortcutRows,
} from "../keybindings";
import { commandTitle, LOCAL_SETS, selectKeybindings, selectLocalKeymap } from "./keybindingState";

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
	expect(commandTitle(currentTranslator(), list, winner)).toBe("Quit ThinkRail");
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

test("the local keymap follows the resolved table: the same object until a rebind", () => {
	const state = {
		protocolVersion: KEYBINDINGS_PROTOCOL_VERSION,
		keybindingOverrides: {},
		disabledExtensions: [],
	};
	const keymap = selectLocalKeymap(state);
	expect(selectLocalKeymap({ ...state })).toBe(keymap);
	expect(keymap.scopes.get("trees")?.find(({ id }) => id === "trees.search")?.chord.code).toBe(
		"KeyS",
	);
	const rebound = selectLocalKeymap({
		...state,
		keybindingOverrides: { "trees.search": ["KeyF"] },
	});
	expect(rebound).not.toBe(keymap);
	expect(rebound.scopes.get("trees")?.find(({ id }) => id === "trees.search")?.chord.code).toBe(
		"KeyF",
	);
});

test("the review surfaces' set resolves in its scope beside the arrow twins, each command with a titled row", () => {
	const rows = (platform: string) =>
		shortcutRows({
			desktop: false,
			keybindings: resolveKeybindings({ platform, local: LOCAL_SETS }),
		});
	const labels = (platform: string, id: string) =>
		rows(platform)
			.find((row) => row.id === id)
			?.chords.map(({ label }) => label);
	expect(labels("Linux x86_64", "review.comment")).toEqual(["↵", "Ctrl+Shift+M"]);
	expect(labels("MacIntel", "review.comment")).toEqual(["↵", "⇧⌘M"]);
	expect(labels("Linux x86_64", "review.saveDraft")).toEqual(["Ctrl+↵"]);
	expect(labels("MacIntel", "review.sendNow")).toEqual(["⇧⌘↵"]);
	const keybindings = resolveKeybindings({ platform: "Linux x86_64", local: LOCAL_SETS });
	expect(keybindings.conflicts).toEqual([]);
	expect(keybindings.local.get("review.surface")?.map(({ id }) => id)).toEqual([
		...REVIEW_SURFACE_COMMANDS.map(({ id }) => id),
		"arrows.left",
		"arrows.down",
		"arrows.up",
		"arrows.right",
	]);
	const listed = new Set(SHORTCUT_CATALOG.flatMap((entry) => entry.local ?? []));
	expect(REVIEW_SURFACE_COMMANDS.filter(({ id }) => !listed.has(id))).toEqual([]);
});
