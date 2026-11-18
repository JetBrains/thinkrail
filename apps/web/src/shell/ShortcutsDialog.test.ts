import { expect, test } from "bun:test";
import { currentTranslator } from "@thinkrail/locales/react";
import type { ShortcutRow } from "../keybindings";
import { shortcutSections } from "./ShortcutsDialog";

const row = (id: string, surface: ShortcutRow["surface"], extension?: string): ShortcutRow => ({
	id,
	title: "shortcuts.search",
	surface,
	...(extension ? { extension } : {}),
	chords: [{ keys: ["F"], label: "F" }],
	conflicts: [],
});

test("an extension's rows leave General for a section titled like its Keyboard area, after the catalog's", () => {
	const sections = shortcutSections(
		currentTranslator(),
		[
			row("search.open", "general"),
			row("session-insights.rows", "general", "session-insights"),
			row("tabs.close", "tabs"),
			row("hint-mode.show", "general", "hint-mode"),
			row("unnamed.key", "general", "unnamed"),
		],
		[
			{ name: "hint-mode", title: "hintMode.title" },
			{ name: "session-insights", title: "sessionInsights.panel.title" },
			{ name: "unnamed" },
			{ name: "quiet", title: "hintMode.title" },
		],
	);
	expect(sections.map(({ key, title, rows }) => [key, title, rows.map(({ id }) => id)])).toEqual([
		["general", "General", ["search.open"]],
		["tabs", "Tabs and groups", ["tabs.close"]],
		["extension:hint-mode", "Hint mode", ["hint-mode.show"]],
		["extension:session-insights", "Session insights", ["session-insights.rows"]],
		["extension:unnamed", "unnamed", ["unnamed.key"]],
	]);
	expect(sections.map(({ surface, extension }) => [surface, extension])).toEqual([
		["general", null],
		["tabs", null],
		[null, "hint-mode"],
		[null, "session-insights"],
		[null, "unnamed"],
	]);
});
