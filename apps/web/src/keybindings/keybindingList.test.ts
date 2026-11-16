import { describe, expect, test } from "bun:test";
import {
	assignChord,
	chordHolder,
	type ExtensionCommandSet,
	type ExtensionShortcutSet,
	keybindingList,
	keybindingsFile,
	planImport,
	resetChord,
	resolveKeybindings,
	SHORTCUT_SURFACES,
} from ".";

const LINUX = "Linux x86_64";
const MAC = "MacIntel";

const notes = (enabled = true): ExtensionCommandSet => ({
	extension: "notes",
	enabled,
	commands: [
		{
			id: "notes.open",
			title: "hintMode.shortcuts.show",
			chords: [{ code: "Semicolon", key: ";", mod: true, shift: true }],
		},
	],
});

const notesKeys = (enabled = true): ExtensionShortcutSet => ({
	extension: "notes",
	enabled,
	shortcuts: [{ id: "notes.close", title: "hintMode.shortcuts.exit", keys: [{ key: "Escape" }] }],
});

function list({
	platform = LINUX,
	desktop = false,
	overrides = {},
	enabled = true,
}: {
	platform?: string;
	desktop?: boolean;
	overrides?: Record<string, string[]>;
	enabled?: boolean;
} = {}) {
	return keybindingList({
		desktop,
		keybindings: resolveKeybindings({ platform, overrides, extensions: [notes(enabled)] }),
		extensions: [notesKeys(enabled)],
	});
}

const entry = (from: ReturnType<typeof list>, command: string) =>
	from.entries.find((candidate) => candidate.command === command);

describe("the keybinding list", () => {
	test("groups the catalog by surface, then lists each extension's commands and its locked keys", () => {
		const { entries } = list();
		const surfaces = entries.flatMap(({ surface }) =>
			surface === null ? [] : [SHORTCUT_SURFACES.indexOf(surface)],
		);
		expect(surfaces).toEqual([...surfaces].sort((a, b) => a - b));
		const firstExtension = entries.findIndex(({ surface }) => surface === null);
		expect(
			entries.slice(firstExtension).map(({ command, source, locked }) => [command, source, locked]),
		).toEqual([
			["notes.open", "notes", false],
			["notes.close", "notes", true],
		]);
		expect(new Set(entries.map(({ command }) => command)).size).toBe(entries.length);
	});

	test("splits the focus-group row into one row per group, titled by its position", () => {
		const groups = list().entries.filter(({ command }) => command.startsWith("focus.group"));
		expect(groups.map(({ command, title, position }) => [command, title, position])).toEqual(
			Array.from({ length: 9 }, (_, index) => [
				`focus.group${index + 1}`,
				"commands.focus.group",
				index + 1,
			]),
		);
	});

	test("element keys are locked rows with their display labels; desktop rows only on the desktop", () => {
		const search = entry(list(), "trees.search");
		expect(search?.locked).toBe(true);
		expect(search?.chords.map(({ label }) => label)).toEqual(["S"]);
		expect(entry(list(), "desktop.settings")).toBeUndefined();
		expect(entry(list({ desktop: true }), "desktop.settings")?.locked).toBe(true);
	});

	test("a browser hides the chords it never receives while another remains; the desktop shows them", () => {
		const shown = (desktop: boolean, command: string) =>
			entry(list({ desktop }), command)?.chords.flatMap(({ text, shown: visible, displayOnly }) =>
				visible ? [`${text}${displayOnly ? " (display)" : ""}`] : [],
			);
		expect(shown(false, "tab.close")).toEqual(["Mod+Alt+KeyW"]);
		expect(shown(true, "tab.close")).toEqual(["Mod+KeyW (display)", "Mod+Alt+KeyW"]);
		expect(shown(false, "workspace.new")).toEqual(["Mod+Alt+KeyN"]);
		expect(entry(list(), "workspace.new")?.chords.map(({ text }) => text)).toEqual([
			"Mod+KeyN",
			"Mod+Alt+KeyN",
		]);
	});

	test("defaults are grammar strings for this platform, and the typed cheatsheet chord its display form", () => {
		expect(entry(list(), "shortcuts.open")?.defaults).toEqual(["Mod+?"]);
		expect(entry(list(), "tab.moveToPreviousGroup")?.defaults).toEqual(["Ctrl+Alt+ArrowLeft"]);
		expect(entry(list({ platform: MAC }), "tab.moveToPreviousGroup")?.defaults).toEqual([
			"Mod+Ctrl+ArrowLeft",
		]);
		const custom = entry(list({ overrides: { "search.open": ["Mod+KeyU"] } }), "search.open");
		expect([custom?.custom, custom?.defaults, custom?.chords.map(({ text }) => text)]).toEqual([
			true,
			["Mod+KeyK"],
			["Mod+KeyU"],
		]);
	});

	test("a hand-written override onto the desktop's Mod+W is marked lost to Close tab, which keeps it", () => {
		const from = list({ desktop: true, overrides: { "search.open": ["Mod+KeyW"] } });
		expect(entry(from, "search.open")?.chords).toEqual([
			expect.objectContaining({ text: "Mod+KeyW", label: "Ctrl+W", lostTo: "tab.close" }),
		]);
		expect(entry(from, "tab.close")?.chords.map(({ text, lostTo }) => [text, lostTo])).toEqual([
			["Mod+KeyW", null],
			["Mod+Alt+KeyW", null],
		]);
	});

	test("a disabled extension's rows stay listed, inactive", () => {
		const off = list({ enabled: false });
		expect(entry(off, "notes.open")?.active).toBe(false);
		expect(entry(off, "notes.close")?.active).toBe(false);
		expect(entry(list(), "notes.open")?.active).toBe(true);
	});
});

describe("editing", () => {
	test("the holder of a chord is the command it is active on, compared by the keys pressed", () => {
		expect(chordHolder(list(), "focus.composer", "Mod+KeyK")).toBe("search.open");
		expect(chordHolder(list(), "search.open", "Mod+KeyK")).toBeNull();
		expect(chordHolder(list(), "focus.composer", "Ctrl+KeyK")).toBe("search.open");
		expect(chordHolder(list({ platform: MAC }), "focus.composer", "Ctrl+KeyK")).toBeNull();
		expect(chordHolder(list({ enabled: false }), "search.open", "Mod+Shift+Semicolon")).toBeNull();
		expect(chordHolder(list(), "search.open", "Mod+Shift+Semicolon")).toBe("notes.open");
	});

	test("the typed cheatsheet chord holds its US position Mod+Shift+/, on every platform", () => {
		for (const platform of [LINUX, MAC]) {
			expect(chordHolder(list({ platform }), "view.toggleLeft", "Mod+Shift+Slash")).toBe(
				"shortcuts.open",
			);
		}
		expect(chordHolder(list(), "view.toggleLeft", "Mod+Slash")).toBeNull();
		expect(chordHolder(list(), "shortcuts.open", "Mod+Shift+Slash")).toBeNull();
		expect(assignChord(list(), {}, "view.toggleLeft", "Mod+Shift+Slash", "shortcuts.open")).toEqual(
			{ "view.toggleLeft": ["Mod+Shift+Slash"], "shortcuts.open": [] },
		);
	});

	test("assigning stores the chord, and a chord equal to the defaults removes the override", () => {
		expect(assignChord(list(), {}, "group.splitRight", "Mod+Alt+KeyS")).toEqual({
			"group.splitRight": ["Mod+Alt+KeyS"],
		});
		const custom = { "search.open": ["Mod+KeyU"], "view.files": [] };
		expect(assignChord(list({ overrides: custom }), custom, "search.open", "Mod+KeyK")).toEqual({
			"view.files": [],
		});
		expect(assignChord(list(), {}, "tab.close", "Mod+Alt+KeyW")).toEqual({});
	});

	test("Replace writes an explicit override for the other command: its chords minus this one", () => {
		expect(assignChord(list(), {}, "focus.composer", "Mod+KeyK", "search.open")).toEqual({
			"focus.composer": ["Mod+KeyK"],
			"search.open": [],
		});
		expect(assignChord(list(), {}, "search.open", "Mod+Alt+KeyN", "workspace.new")).toEqual({
			"search.open": ["Mod+Alt+KeyN"],
			"workspace.new": ["Mod+KeyN"],
		});
		const custom = { "view.files": ["Mod+KeyU", "Mod+Shift+KeyE"] };
		expect(
			assignChord(list({ overrides: custom }), custom, "search.open", "Mod+KeyU", "view.files"),
		).toEqual({
			"search.open": ["Mod+KeyU"],
		});
	});

	test("Reset removes the command's override only", () => {
		expect(resetChord({ "search.open": [], "view.files": ["Mod+KeyU"] }, "search.open")).toEqual({
			"view.files": ["Mod+KeyU"],
		});
	});
});

describe("the keybindings file", () => {
	const english = (title: string, position: number | null) =>
		position === null ? title : `${title} ${position}`;

	test("lists every row: chords and defaults for commands, display keys for locked rows", () => {
		const from = list({ overrides: { "search.open": ["Mod+KeyU"] } });
		const file = keybindingsFile(from, ({ title, position }) => english(title, position));
		expect([file.format, file.version, file.bindings.length]).toEqual([
			"thinkrail-keybindings",
			1,
			from.entries.length,
		]);
		const binding = (command: string) => file.bindings.find((item) => item.command === command);
		expect(binding("search.open")).toEqual({
			command: "search.open",
			title: "shortcuts.search",
			source: "thinkrail",
			chords: ["Mod+KeyU"],
			defaults: ["Mod+KeyK"],
			changed: true,
		});
		expect(binding("trees.search")).toEqual({
			command: "trees.search",
			title: "shortcuts.trees.search",
			source: "thinkrail",
			locked: true,
			keys: ["S"],
		});
		expect(binding("shortcuts.open")).toMatchObject({ chords: ["Mod+?"], defaults: ["Mod+?"] });
		expect(binding("focus.group3")?.title).toBe("commands.focus.group 3");
	});

	test("marks a disabled extension's entries inactive and a losing chord with its winner", () => {
		const off = keybindingsFile(list({ enabled: false }), ({ title }) => title);
		expect(off.bindings.find(({ command }) => command === "notes.open")?.active).toBe(false);
		const lost = keybindingsFile(
			list({ overrides: { "search.open": ["Mod+Shift+Semicolon"] } }),
			({ title }) => title,
		);
		expect(lost.bindings.find(({ command }) => command === "notes.open")?.conflict).toEqual({
			chord: "Mod+Shift+Semicolon",
			winner: "search.open",
		});
	});
});

describe("planImport", () => {
	const file = (bindings: unknown[]) => ({ format: "thinkrail-keybindings", version: 1, bindings });

	test("refuses anything but a version-1 keybindings file", () => {
		expect(planImport({}, list(), null)).toBeNull();
		expect(planImport({}, list(), { format: "other", version: 1, bindings: [] })).toBeNull();
		expect(planImport({}, list(), { ...file([]), version: 2 })).toBeNull();
		expect(planImport({}, list(), { ...file([]), bindings: {} })).toBeNull();
	});

	test("plans the changes and skips locked, unknown, invalid, plain and desktop-native entries", () => {
		const plan = planImport(
			{},
			list(),
			file([
				{ command: "group.splitRight", chords: ["Mod+Alt+KeyS"] },
				{ command: "trees.search", chords: ["Mod+KeyF"], locked: true },
				{ command: "old-extension.run", chords: ["Mod+Shift+KeyR"] },
				{ command: "view.files", chords: ["Mod+?"] },
				{ command: "view.changes", chords: ["KeyG"] },
				{ command: "view.toggleLeft", chords: ["Mod+KeyQ"] },
				{ command: "view.toggleRight", chords: "Mod+KeyJ" },
				{ chords: [] },
			]),
		);
		expect(plan?.changes).toEqual([
			{ command: "group.splitRight", from: ["Ctrl+\\"], to: ["Ctrl+Alt+S"] },
		]);
		expect(plan?.skipped).toEqual([
			{ command: "trees.search", reason: "locked" },
			{ command: "old-extension.run", reason: "unknown" },
			{ command: "view.files", reason: "invalid" },
			{ command: "view.changes", reason: "plain" },
			{ command: "view.toggleLeft", reason: "desktop" },
			{ command: "view.toggleRight", reason: "invalid" },
			{ command: "", reason: "invalid" },
		]);
		expect(plan?.overrides).toEqual({ "group.splitRight": ["Mod+Alt+KeyS"] });
	});

	test("an export of the current state imports as unchanged, the typed cheatsheet chord included", () => {
		const current = list({ overrides: { "search.open": ["Mod+KeyU"] } });
		const exported = keybindingsFile(current, ({ title }) => title);
		const plan = planImport({ "search.open": ["Mod+KeyU"] }, current, exported);
		const locked = current.entries.filter((item) => item.locked).length;
		expect(plan?.changes).toEqual([]);
		expect(plan?.skipped.length).toBe(locked);
		expect(plan?.unchanged).toBe(current.entries.length - locked);
		expect(
			planImport({}, list(), file([{ command: "shortcuts.open", chords: ["Mod+?"] }]))?.unchanged,
		).toBe(1);
	});

	test("an entry at its own defaults means the defaults, so another platform's file keeps them", () => {
		const mac = {
			command: "tab.moveToPreviousGroup",
			chords: ["Mod+Ctrl+ArrowLeft"],
			defaults: ["Mod+Ctrl+ArrowLeft"],
		};
		expect(planImport({}, list(), file([mac]))?.unchanged).toBe(1);
		const custom = { "tab.moveToPreviousGroup": ["Mod+KeyU"] };
		const reset = planImport(custom, list({ overrides: custom }), file([mac]));
		expect(reset?.changes).toEqual([
			{ command: "tab.moveToPreviousGroup", from: ["Ctrl+U"], to: ["Ctrl+Alt+←"] },
		]);
		expect(reset?.overrides).toEqual({});
	});

	test("a chord taken from another command stays with the import, which unbinds it there", () => {
		const plan = planImport(
			{},
			list(),
			file([{ command: "focus.composer", chords: ["Mod+KeyK"] }]),
		);
		expect(plan?.conflicts).toEqual([
			{ chord: "Ctrl+K", command: "focus.composer", other: "search.open" },
		]);
		expect(plan?.overrides).toEqual({ "focus.composer": ["Mod+KeyK"], "search.open": [] });
		const both = planImport(
			{},
			list(),
			file([
				{ command: "focus.composer", chords: ["Mod+KeyK"] },
				{ command: "search.open", chords: ["Mod+KeyU"] },
			]),
		);
		expect(both?.conflicts).toEqual([]);
		expect(both?.overrides).toEqual({
			"focus.composer": ["Mod+KeyK"],
			"search.open": ["Mod+KeyU"],
		});
	});

	test("a chord on the typed cheatsheet chord's US position takes it, unbinding the cheatsheet", () => {
		const plan = planImport(
			{},
			list(),
			file([{ command: "view.toggleLeft", chords: ["Mod+Shift+Slash"] }]),
		);
		expect(plan?.conflicts).toEqual([
			{ chord: "Ctrl+Shift+/", command: "view.toggleLeft", other: "shortcuts.open" },
		]);
		expect(plan?.overrides).toEqual({
			"view.toggleLeft": ["Mod+Shift+Slash"],
			"shortcuts.open": [],
		});
	});

	test("a disabled extension's commands import, and conflict with nothing", () => {
		const plan = planImport(
			{},
			list({ enabled: false }),
			file([{ command: "notes.open", chords: ["Mod+KeyK"] }]),
		);
		expect(plan?.changes.map(({ command }) => command)).toEqual(["notes.open"]);
		expect(plan?.conflicts).toEqual([]);
		expect(plan?.overrides).toEqual({ "notes.open": ["Mod+KeyK"] });
	});
});
