import { describe, expect, test } from "bun:test";
import {
	type ExtensionCommandSet,
	type KeybindingEntry,
	keybindingList,
	resolveKeybindings,
	SHORTCUT_SURFACES,
} from "../keybindings";
import { SettingsSection } from "../store";
import {
	areaOfSetting,
	chordName,
	keybindingAreas,
	resetArea,
	scopeRuns,
	shortcutSearchEntries,
	shortcutSettingId,
} from "./keybindingAreas";

const LINUX = "Linux x86_64";

const notes: ExtensionCommandSet = {
	extension: "notes",
	enabled: true,
	commands: [
		{
			id: "notes.open",
			title: "hintMode.shortcuts.show",
			chords: [{ code: "Semicolon", key: ";", mod: true, shift: true }],
		},
	],
};

function areasFor(overrides: Record<string, string[]> = {}) {
	const list = keybindingList({
		desktop: false,
		keybindings: resolveKeybindings({ platform: LINUX, overrides, extensions: [notes] }),
		extensions: [
			{
				extension: "notes",
				enabled: true,
				shortcuts: [
					{ id: "notes.close", title: "hintMode.shortcuts.exit", keys: [{ key: "Escape" }] },
				],
			},
		],
	});
	return { list, areas: keybindingAreas(list, ["notes", "absent"]) };
}

const ids = (entries: readonly KeybindingEntry[]) => entries.map((entry) => entry.id);

describe("keybindingAreas", () => {
	test("one area per surface in catalog order, then one per extension with rows; none is empty", () => {
		const { list, areas } = areasFor();
		const surfaces = areas.flatMap((area) => (area.surface === null ? [] : [area.surface]));
		expect(surfaces).toEqual(SHORTCUT_SURFACES.filter((surface) => surfaces.includes(surface)));
		expect(areas.at(-1)?.id).toBe("notes");
		expect(areas.some((area) => area.id === "absent")).toBe(false);
		expect(areas.every((area) => area.entries.length > 0)).toBe(true);
		expect(areas.flatMap((area) => ids(area.entries))).toEqual(ids(list.entries));
		expect(ids(areas.find((area) => area.id === "notes")?.entries ?? [])).toEqual([
			"notes.open",
			"notes.close",
		]);
	});

	test("entry ids are unique, so every shortcut has one jump target", () => {
		const { list } = areasFor();
		expect(new Set(ids(list.entries)).size).toBe(list.entries.length);
	});

	test("an area counts its changed shortcuts; untouched areas count none", () => {
		const { areas: before } = areasFor();
		expect(before.every((area) => area.changed === 0)).toBe(true);
		const { areas } = areasFor({
			"group.splitRight": ["Mod+Alt+KeyS"],
			"tab.close": ["Mod+Alt+KeyW"],
			"trees.search": ["KeyG"],
		});
		const changed = Object.fromEntries(areas.map((area) => [area.id, area.changed]));
		expect(changed.tabs).toBe(2);
		expect(changed.trees).toBe(1);
		expect(changed.general).toBe(0);
		const tabs = areas.find((area) => area.id === "tabs");
		expect(tabs?.entries.filter((entry) => entry.custom).map((entry) => entry.id)).toEqual([
			"tab.close",
			"group.splitRight",
		]);
	});

	test("an area shares a scope only when every row has the same local one", () => {
		const { areas } = areasFor();
		const scope = Object.fromEntries(areas.map((area) => [area.id, area.scope]));
		expect(scope.trees).toBe("trees");
		expect(scope.general).toBeNull();
		expect(scope.tabs).toBeNull();
		expect(scope.notes).toBeNull();
	});

	test("scope runs split an area's rows where the scope changes", () => {
		const { areas } = areasFor();
		const general = areas.find((area) => area.id === "general");
		const runs = scopeRuns(general?.entries ?? []);
		expect(runs.map((run) => run.scope)).toEqual([null, "arrows", "reading"]);
		expect(runs.flatMap((run) => ids(run.entries))).toEqual(ids(general?.entries ?? []));
	});
});

test("a shortcut setting id names the area holding it; other ids name none", () => {
	const { areas } = areasFor();
	expect(areaOfSetting(areas, shortcutSettingId("group.splitRight"))).toBe("tabs");
	expect(areaOfSetting(areas, "shortcut:trees.search")).toBe("trees");
	expect(areaOfSetting(areas, "shortcut:notes.open")).toBe("notes");
	expect(areaOfSetting(areas, "shortcut:missing")).toBeNull();
	expect(areaOfSetting(areas, "double-shift")).toBeNull();
	expect(areaOfSetting(areas, null)).toBeNull();
});

test("resetting an area drops only its changed shortcuts' overrides", () => {
	const overrides = {
		"group.splitRight": ["Mod+Alt+KeyS"],
		"tab.close": ["Mod+Alt+KeyW"],
		"trees.search": ["KeyG"],
	};
	const { areas } = areasFor(overrides);
	const tabs = areas.find((area) => area.id === "tabs");
	if (!tabs) throw new Error("no tabs area");
	expect(resetArea(overrides, tabs)).toEqual({ "trees.search": ["KeyG"] });
});

test("search entries carry one shortcut setting per row, in the Keyboard section, with its chords", () => {
	const { areas } = areasFor({ "group.splitRight": [] });
	const entries = shortcutSearchEntries(areas, {
		title: (entry) => `title:${entry.id}`,
		area: (area) => `area:${area.id}`,
		unbound: "Not assigned",
	});
	expect(entries).toHaveLength(areas.reduce((total, area) => total + area.entries.length, 0));
	expect(entries.every((entry) => entry.section === SettingsSection.Keyboard)).toBe(true);
	expect(entries.find((entry) => entry.id === "shortcut:tab.close")).toEqual({
		id: "shortcut:tab.close",
		section: SettingsSection.Keyboard,
		label: "title:tab.close",
		description: "Ctrl+Alt+W",
		keywords: ["area:tabs", "Ctrl+Alt+W", "shortcut", "keybinding"],
	});
	expect(entries.find((entry) => entry.id === "shortcut:group.splitRight")?.description).toBe(
		"Not assigned",
	);
	expect(chordName("Mod+Backslash", LINUX)).toBe("Ctrl+\\");
});
