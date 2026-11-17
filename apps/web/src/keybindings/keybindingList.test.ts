import { describe, expect, test } from "bun:test";
import { REVIEW_SURFACE_COMMANDS } from "@thinkrail/resource-renderers";
import {
	APP_LOCAL_COMMANDS,
	assignChord,
	chordHolders,
	type ExtensionCommandSet,
	type ExtensionShortcutSet,
	keybindingList,
	keybindingsFile,
	matchLocal,
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

const entry = (from: ReturnType<typeof list>, id: string) =>
	from.entries.find((candidate) => candidate.id === id);

const holders = (from: ReturnType<typeof list>, command: string, chord: string) =>
	chordHolders(from, command, chord).map((holder) => holder.command);

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
		expect(new Set(entries.map(({ id }) => id)).size).toBe(entries.length);
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

	test("splits the suggestion keys into one rebindable row per chip, in the chat's shared scope", () => {
		const sends = list().entries.filter(({ command }) => command.startsWith("suggestions.send"));
		expect(
			sends.map(({ command, title, position, scope }) => [command, title, position, scope]),
		).toEqual(
			Array.from({ length: 9 }, (_, index) => [
				`suggestions.send${index + 1}`,
				"shortcuts.suggestions.sendOne",
				index + 1,
				"suggestions",
			]),
		);
	});

	test("element keys are locked rows with their display labels; desktop rows only on the desktop", () => {
		const firstLast = entry(list(), "trees.firstLast");
		expect([firstLast?.locked, firstLast?.scope]).toEqual([true, "trees"]);
		expect(firstLast?.chords.map(({ label }) => label)).toEqual(["Home", "End"]);
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
		expect(holders(list(), "focus.composer", "Mod+KeyK")).toEqual(["search.open"]);
		expect(holders(list(), "search.open", "Mod+KeyK")).toEqual([]);
		expect(holders(list(), "focus.composer", "Ctrl+KeyK")).toEqual(["search.open"]);
		expect(holders(list({ platform: MAC }), "focus.composer", "Ctrl+KeyK")).toEqual([]);
		expect(holders(list({ enabled: false }), "search.open", "Mod+Shift+Semicolon")).toEqual([]);
		expect(holders(list(), "search.open", "Mod+Shift+Semicolon")).toEqual(["notes.open"]);
	});

	test("the typed cheatsheet chord holds its US position Mod+Shift+/, on every platform", () => {
		for (const platform of [LINUX, MAC]) {
			expect(holders(list({ platform }), "view.toggleLeft", "Mod+Shift+Slash")).toEqual([
				"shortcuts.open",
			]);
		}
		expect(holders(list(), "view.toggleLeft", "Mod+Slash")).toEqual([]);
		expect(holders(list(), "shortcuts.open", "Mod+Shift+Slash")).toEqual([]);
		expect(assignChord(list(), {}, "view.toggleLeft", "Mod+Shift+Slash", true)).toEqual({
			"view.toggleLeft": ["Mod+Shift+Slash"],
			"shortcuts.open": [],
		});
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
		expect(assignChord(list(), {}, "focus.composer", "Mod+KeyK", true)).toEqual({
			"focus.composer": ["Mod+KeyK"],
			"search.open": [],
		});
		expect(assignChord(list(), {}, "search.open", "Mod+Alt+KeyN", true)).toEqual({
			"search.open": ["Mod+Alt+KeyN"],
			"workspace.new": ["Mod+KeyN"],
		});
		const custom = { "view.files": ["Mod+KeyU", "Mod+Shift+KeyE"] };
		expect(
			assignChord(list({ overrides: custom }), custom, "search.open", "Mod+KeyU", true),
		).toEqual({
			"search.open": ["Mod+KeyU"],
		});
	});

	test("a disabled extension's command takes a chord from no one, so search keeps Mod+K", () => {
		const off = list({ enabled: false });
		expect(holders(off, "notes.open", "Mod+KeyK")).toEqual([]);
		expect(assignChord(off, {}, "notes.open", "Mod+KeyK", true)).toEqual({
			"notes.open": ["Mod+KeyK"],
		});
		expect(holders(list(), "notes.open", "Mod+KeyK")).toEqual(["search.open"]);
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
			scope: "trees",
			chords: ["KeyS"],
			defaults: ["KeyS"],
			changed: false,
		});
		expect(binding("trees.down")).toEqual({
			command: "trees.down",
			title: "shortcuts.trees.down",
			source: "thinkrail",
			scope: "trees",
			alias: "arrows.down",
			fixed: { keys: ["↓"], locked: true },
			chords: ["KeyJ"],
			defaults: ["KeyJ"],
			changed: false,
		});
		expect(binding("trees.firstLast")).toEqual({
			command: "trees.firstLast",
			title: "shortcuts.trees.firstLast",
			source: "thinkrail",
			scope: "trees",
			locked: true,
			keys: ["Home", "End"],
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
				{ command: "trees.firstLast", chords: ["Mod+KeyF"], locked: true },
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
			{ command: "trees.firstLast", reason: "locked" },
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
			{ chord: "Ctrl+K", command: "focus.composer", other: "search.open", scope: null },
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
			{ chord: "Ctrl+Shift+/", command: "view.toggleLeft", other: "shortcuts.open", scope: null },
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

describe("local rows", () => {
	test("a local command is an editable row in its element's scope; a direction row edits the shared twin", () => {
		const search = entry(list(), "trees.search");
		expect([search?.command, search?.scope, search?.locked, search?.plain]).toEqual([
			"trees.search",
			"trees",
			false,
			true,
		]);
		const down = entry(list(), "trees.down");
		expect([down?.command, down?.scope, down?.locked]).toEqual(["arrows.down", "trees", false]);
		expect(down?.fixed.map(({ label }) => label)).toEqual(["↓"]);
		expect(down?.chords.map(({ label }) => label)).toEqual(["J"]);
		const extend = entry(list(), "review.extendUp");
		expect([extend?.locked, extend?.chords.map(({ label }) => label)]).toEqual([true, ["Shift+K"]]);
		expect(entry(list(), "arrows.down")?.scope).toBe("arrows");
	});

	test("a local chord conflicts only inside the elements its command acts in", () => {
		expect(chordHolders(list(), "trees.search", "KeyJ")).toEqual([
			{ command: "arrows.down", scope: "trees" },
		]);
		expect(chordHolders(list(), "arrows.up", "KeyS")).toEqual([
			{ command: "trees.search", scope: "trees" },
			{ command: "settings.nav.search", scope: "settings.nav" },
		]);
		expect(holders(list(), "trees.search", "KeyC")).toEqual([]);
		expect(holders(list(), "transcript.copy", "KeyS")).toEqual([]);
		expect(holders(list(), "trees.search", "Mod+KeyK")).toEqual([]);
		expect(holders(list(), "view.toggleLeft", "KeyS")).toEqual([]);
	});

	test("a shared twin's key lists every element's holder, each command once", () => {
		const apart = list({ overrides: { "trees.search": ["KeyX"], "transcript.copy": ["KeyX"] } });
		expect(chordHolders(apart, "arrows.down", "KeyX")).toEqual([
			{ command: "trees.search", scope: "trees" },
			{ command: "transcript.copy", scope: "transcript" },
		]);
		const twin = list({ overrides: { "arrows.up": ["KeyX"] } });
		expect(chordHolders(twin, "arrows.down", "KeyX")).toEqual([
			{ command: "arrows.up", scope: "tabs" },
		]);
	});

	test("Replace unbinds an own-scope holder, but a shared twin only loses inside that element", () => {
		expect(assignChord(list(), {}, "trees.search", "F2", true)).toEqual({
			"trees.search": ["F2"],
			"trees.rename": [],
		});
		expect(assignChord(list(), {}, "trees.search", "KeyJ", true)).toEqual({
			"trees.search": ["KeyJ"],
		});
		expect(assignChord(list(), {}, "arrows.up", "KeyS", true)).toEqual({
			"arrows.up": ["KeyS"],
			"trees.search": [],
			"settings.nav.search": ["Slash"],
		});
	});

	test("a global row notes where a local key takes its chord; a twin where an element took it", () => {
		const shadowed = list({
			overrides: {
				"trees.search": ["Mod+KeyK"],
				"arrows.down": ["KeyU"],
				"transcript.copy": ["KeyU"],
			},
		});
		expect(entry(shadowed, "search.open")?.yields).toEqual([
			{ scope: "trees", label: "Ctrl+K", winner: "trees.search" },
		]);
		expect(entry(shadowed, "arrows.down")?.yields).toEqual([
			{ scope: "transcript", label: "U", winner: "transcript.copy" },
		]);
		expect(entry(shadowed, "transcript.down")?.chords.map(({ lostTo }) => lostTo)).toEqual([
			"transcript.copy",
		]);
		expect(entry(shadowed, "trees.down")?.chords.map(({ lostTo }) => lostTo)).toEqual([null]);
	});

	test("import takes plain local keys, refuses navigation keys and keeps conflicts inside a scope", () => {
		const file = (bindings: unknown[]) => ({
			format: "thinkrail-keybindings",
			version: 1,
			bindings,
		});
		const plan = planImport(
			{},
			list(),
			file([
				{ command: "trees.search", scope: "trees", chords: ["KeyG"] },
				{ command: "transcript.copy", chords: ["ArrowDown"] },
				{ command: "trees.rename", chords: ["KeyC"] },
				{ command: "trees.down", alias: "arrows.down", chords: ["KeyU"] },
				{ command: "transcript.down", alias: "arrows.down", chords: ["KeyU"] },
				{ command: "tabs.next", alias: "arrows.right", chords: ["KeyY"] },
				{ command: "rails.right", alias: "arrows.right", chords: ["KeyZ"] },
			]),
		);
		expect(plan?.changes.map(({ command, to }) => [command, to])).toEqual([
			["trees.search", ["G"]],
			["trees.rename", ["C"]],
			["trees.down", ["U"]],
			["tabs.next", ["Y"]],
		]);
		expect(plan?.skipped).toEqual([
			{ command: "transcript.copy", reason: "primitive" },
			{ command: "rails.right", reason: "unknown" },
		]);
		expect(plan?.conflicts).toEqual([]);
		expect(plan?.overrides).toEqual({
			"trees.search": ["KeyG"],
			"trees.rename": ["KeyC"],
			"arrows.down": ["KeyU"],
			"arrows.right": ["KeyY"],
		});
		const conflicting = planImport(
			{},
			list(),
			file([
				{ command: "trees.search", chords: ["F2"] },
				{ command: "trees.delete", chords: ["KeyJ"] },
			]),
		);
		expect(conflicting?.conflicts).toEqual([
			{ chord: "F2", command: "trees.search", other: "trees.rename", scope: "trees" },
			{ chord: "J", command: "trees.delete", other: "arrows.down", scope: "trees" },
		]);
		expect(conflicting?.overrides).toEqual({
			"trees.search": ["F2"],
			"trees.delete": ["KeyJ"],
			"trees.rename": [],
		});
	});

	test("every Enter chord also takes the numpad Enter by default, and a rebind replaces both", () => {
		const paired = [...APP_LOCAL_COMMANDS, ...REVIEW_SURFACE_COMMANDS].flatMap(({ id, chords }) => {
			const of = (code: string) =>
				chords.flatMap(({ code: own, key: _key, ...modifiers }) =>
					own === code ? [JSON.stringify(modifiers)] : [],
				);
			const enter = of("Enter");
			return enter.length === 0 ? [] : [[id, enter, of("NumpadEnter")]];
		});
		expect(paired.map(([id]) => id)).toEqual([
			"trees.openKept",
			"composer.followUp",
			"composer.interrupt",
			"history.send",
			"palette.startWork",
			"palette.ask",
			"findInFiles.openKept",
			"review.surface.saveDraft",
			"review.surface.sendNow",
		]);
		for (const [id, enter, numpad] of paired) expect([id, numpad]).toEqual([id, enter]);

		const numpadSend = { code: "NumpadEnter", key: "Enter", ctrlKey: true, metaKey: false };
		const send = { ...numpadSend, altKey: false, shiftKey: false };
		const followUp = entry(list(), "composer.followUp");
		expect(followUp?.defaults).toEqual(["Mod+Enter", "Mod+NumpadEnter"]);
		expect(followUp?.chords.map(({ label }) => label)).toEqual(["Ctrl+↵", "Ctrl+Num ↵"]);
		expect(matchLocal(list().keybindings, ["composer"], send)).toBe("composer.followUp");

		const rebound = assignChord(list(), {}, "composer.followUp", "Alt+KeyQ");
		expect(rebound).toEqual({ "composer.followUp": ["Alt+KeyQ"] });
		expect(matchLocal(list({ overrides: rebound }).keybindings, ["composer"], send)).toBeNull();
		expect(assignChord(list(), rebound, "composer.followUp", "Mod+Enter")).toEqual({
			"composer.followUp": ["Mod+Enter"],
		});
		expect(resetChord(rebound, "composer.followUp")).toEqual({});
	});
});
