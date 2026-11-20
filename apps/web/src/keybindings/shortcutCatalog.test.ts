import { describe, expect, test } from "bun:test";
import { EN } from "@thinkrail/locales";
import {
	APP_LOCAL_COMMANDS,
	actsIn,
	elementKeyUses,
	KEYBINDINGS,
	type KeybindingId,
	resolveKeybindings,
	SHORTCUT_CATALOG,
	SHORTCUT_SURFACE_TITLES,
	SHORTCUT_SURFACES,
	type ShortcutRow,
	shortcutRows,
} from ".";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";
const WINDOWS = "Win32";

type ResolveInput = Omit<Parameters<typeof resolveKeybindings>[0], "platform">;

const rowsFor = (desktop: boolean, platform: string, input: ResolveInput = {}) =>
	shortcutRows({ desktop, keybindings: resolveKeybindings({ platform, ...input }) });

const labels = (rows: readonly ShortcutRow[], id: string) =>
	rows.find((row) => row.id === id)?.chords.map((chord) => chord.label);

describe("the shortcut catalog", () => {
	test("lists every app-wide binding under a titled entry", () => {
		const listed = new Set<KeybindingId>(SHORTCUT_CATALOG.flatMap((entry) => entry.bindings ?? []));
		expect(Object.keys(KEYBINDINGS).filter((id) => !listed.has(id as KeybindingId))).toEqual([]);
	});

	test("ids are unique and every title and surface title is an English key", () => {
		const ids = SHORTCUT_CATALOG.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
		const titles = [
			...SHORTCUT_CATALOG.map((entry) => entry.title),
			...Object.values(SHORTCUT_SURFACE_TITLES),
		];
		expect(titles.filter((title) => !Object.hasOwn(EN, title))).toEqual([]);
		expect(SHORTCUT_CATALOG.filter((entry) => !SHORTCUT_SURFACES.includes(entry.surface))).toEqual(
			[],
		);
	});

	test("lists the bottom rail's horizontal keys apart from the side rails' vertical ones", () => {
		const rows = rowsFor(false, LINUX);
		expect(labels(rows, "rails.up")).toEqual(["↑", "K"]);
		expect(labels(rows, "rails.down")).toEqual(["↓", "J"]);
		expect(labels(rows, "rails.left")).toEqual(["←", "H"]);
		expect(labels(rows, "rails.right")).toEqual(["→", "L"]);
		expect(labels(rows, "rails.firstLast")).toEqual(["Home", "End"]);
		expect(labels(rows, "rails.moveUp")).toEqual(["Alt+Shift+↑"]);
		expect(labels(rows, "rails.moveLeft")).toEqual(["Alt+Shift+←"]);
	});

	test("every app local command has a titled row, and every direction or end row one letter twin", () => {
		const local = new Set(SHORTCUT_CATALOG.flatMap((entry) => entry.local ?? []));
		expect(APP_LOCAL_COMMANDS.filter(({ id }) => !local.has(id)).map(({ id }) => id)).toEqual([]);
		const resolved = resolveKeybindings({ platform: LINUX });
		const twins = SHORTCUT_CATALOG.flatMap((entry) => (entry.twin ? [entry] : []));
		expect(twins.length).toBeGreaterThan(0);
		for (const entry of twins) {
			const scope = resolved.byId.get(entry.twin?.command ?? "")?.scope ?? "";
			expect([entry.id, entry.keys?.length, ["arrows", "reading"].includes(scope)]).toEqual([
				entry.id,
				1,
				true,
			]);
			expect(entry.scope && actsIn(resolved, scope).includes(entry.scope)).toBe(true);
		}
	});

	test("a rebound twin shows on every direction row; inside an element that took it over it shows lost", () => {
		const rows = rowsFor(false, LINUX, {
			overrides: { "arrows.down": ["KeyU"], "trees.search": ["KeyU"] },
		});
		expect(labels(rows, "transcript.down")).toEqual(["↓", "U"]);
		expect(labels(rows, "trees.down")).toEqual(["↓"]);
		expect(rows.find((row) => row.id === "trees.down")?.conflicts).toEqual([
			{ keys: ["U"], label: "U", winner: "trees.search" },
		]);
		expect(labels(rows, "trees.search")).toEqual(["U"]);
		expect(labels(rows, "arrows.down")).toEqual(["U"]);
	});

	test("lists the trees' letters: hjkl beside the arrows and S for search", () => {
		const rows = rowsFor(false, LINUX);
		expect(labels(rows, "trees.up")).toEqual(["↑", "K"]);
		expect(labels(rows, "trees.down")).toEqual(["↓", "J"]);
		expect(labels(rows, "trees.expand")).toEqual(["→", "L"]);
		expect(labels(rows, "trees.collapse")).toEqual(["←", "H"]);
		expect(labels(rows, "trees.search")).toEqual(["S"]);
		expect(labels(rows, "trees.searchStep")).toEqual(["↓", "↑"]);
		expect(labels(rows, "trees.searchKeep")).toEqual(["↵"]);
		expect(labels(rows, "trees.searchCancel")).toEqual(["Esc"]);
		expect(labels(rows, "trees.typeAhead")).toBeUndefined();
	});

	test("lists enabled extension commands with their chords, then extra rows, after the catalog", () => {
		const extensions = [
			{
				extension: "hint-mode",
				enabled: true,
				commands: [
					{
						id: "hint-mode.show",
						title: "hintMode.shortcuts.show",
						chords: [
							{ code: "KeyF", key: "f" },
							{ code: "Semicolon", key: ";", mod: true },
						],
					},
				],
			},
		] as const;
		const extra = [
			{
				id: "hint-mode.exit",
				title: "hintMode.shortcuts.exit",
				surface: "general",
				keys: [{ key: "Escape" }],
			},
		] as const;
		const mac = shortcutRows({
			desktop: false,
			keybindings: resolveKeybindings({ platform: MAC, extensions }),
			extra,
		});
		const linux = rowsFor(false, LINUX, { extensions });
		expect(labels(mac, "hint-mode.show")).toEqual(["F", "⌘;"]);
		expect(labels(linux, "hint-mode.show")).toEqual(["F", "Ctrl+;"]);
		expect(
			mac
				.filter((row) => row.surface === "general")
				.slice(-2)
				.map((row) => row.id),
		).toEqual(["hint-mode.show", "hint-mode.exit"]);
		expect(labels(rowsFor(false, LINUX), "hint-mode.show")).toBeUndefined();
		const off = rowsFor(false, LINUX, { extensions: [{ ...extensions[0], enabled: false }] });
		expect(labels(off, "hint-mode.show")).toBeUndefined();
	});

	test("shows effective chords: an override at once, an unbound command not at all", () => {
		const rows = rowsFor(false, LINUX, {
			overrides: { "search.open": ["Mod+Alt+KeyS"], "files.findInFiles": [] },
		});
		expect(labels(rows, "search.open")).toEqual(["Ctrl+Alt+S"]);
		expect(labels(rows, "files.findInFiles")).toBeUndefined();
		const group = rowsFor(false, LINUX, { overrides: { "focus.group2": ["Mod+Alt+Digit2"] } });
		expect(labels(group, "focus.group")?.slice(0, 3)).toEqual(["Ctrl+1", "Ctrl+Alt+2", "Ctrl+3"]);
	});

	test("shows the suggestion keys as one range row until one of them is rebound", () => {
		expect(labels(rowsFor(false, LINUX), "suggestions.send")).toEqual(["Alt+1–9"]);
		expect(labels(rowsFor(false, MAC), "suggestions.send")).toEqual(["⌥1–9"]);
		const rebound = rowsFor(false, LINUX, { overrides: { "suggestions.send2": ["Alt+KeyQ"] } });
		expect(labels(rebound, "suggestions.send")?.slice(0, 3)).toEqual(["Alt+1", "Alt+Q", "Alt+3"]);
		expect(rowsFor(false, LINUX).find(({ id }) => id === "suggestions.send")?.surface).toBe(
			"general",
		);
		expect(actsIn(resolveKeybindings({ platform: LINUX }), "suggestions")).toEqual([]);
	});

	test("carries a losing chord as a conflict with its winner, not as an active chord", () => {
		const rows = rowsFor(false, LINUX, {
			extensions: [
				{
					extension: "notes",
					enabled: true,
					commands: [
						{
							id: "notes.open",
							title: "hintMode.shortcuts.show",
							chords: [
								{ code: "KeyK", key: "k", mod: true },
								{ code: "KeyO", key: "o", mod: true, alt: true },
							],
						},
					],
				},
			],
			overrides: { "view.toggleLeft": ["Mod+KeyL"] },
		});
		const notes = rows.find((row) => row.id === "notes.open");
		expect(notes?.chords.map((chord) => chord.label)).toEqual(["Ctrl+Alt+O"]);
		expect(notes?.conflicts).toEqual([
			{ keys: ["Ctrl", "K"], label: "Ctrl+K", winner: "search.open" },
		]);
		const composer = rows.find((row) => row.id === "focus.composer");
		expect(composer?.chords).toEqual([]);
		expect(composer?.conflicts).toEqual([
			{ keys: ["Ctrl", "L"], label: "Ctrl+L", winner: "view.toggleLeft" },
		]);
		expect(rows.find((row) => row.id === "search.open")?.conflicts).toEqual([]);
	});

	test("marks an override onto a desktop chord inactive, taken by the desktop's row", () => {
		const rows = rowsFor(true, LINUX, { overrides: { "search.open": ["Mod+KeyQ"] } });
		const search = rows.find((row) => row.id === "search.open");
		expect(search?.chords).toEqual([]);
		expect(search?.conflicts).toEqual([
			{ keys: ["Ctrl", "Q"], label: "Ctrl+Q", winner: "desktop.quit" },
		]);
		expect(labels(rows, "desktop.quit")).toEqual(["Ctrl+Q"]);
	});

	test("lists the transcript's and the strips' letters beside the arrows they repeat", () => {
		const rows = rowsFor(false, LINUX);
		expect(labels(rows, "transcript.up")).toEqual(["↑", "K"]);
		expect(labels(rows, "transcript.expand")).toEqual(["→", "L"]);
		expect(labels(rows, "transcript.page")).toEqual(["PgUp", "PgDn", "Space", "Shift+Space"]);
		expect(labels(rows, "transcript.first")).toEqual(["Home", "G"]);
		expect(labels(rows, "transcript.last")).toEqual(["End", "Shift+G"]);
		expect(labels(rows, "reader.down")).toEqual(["↓", "J"]);
		expect(labels(rows, "reader.bottom")).toEqual(["End", "Shift+G"]);
		expect(labels(rows, "reader.back")).toEqual(["Esc"]);
		expect(labels(rows, "tabs.previous")).toEqual(["←", "H"]);
		expect(labels(rows, "tabs.next")).toEqual(["→", "L"]);
		expect(labels(rows, "composer.enterTranscript")).toEqual(["Ctrl+↑"]);
		expect(labels(rowsFor(false, MAC), "composer.enterTranscript")).toEqual(["⌘↑"]);
	});

	test("takes table chords from the table, never chords a browser does not deliver", () => {
		const browser = rowsFor(false, LINUX);
		expect(labels(browser, "workspace.new")).toEqual(["Ctrl+Alt+N"]);
		expect(labels(browser, "tab.close")).toEqual(["Ctrl+Alt+W"]);
		expect(labels(browser, "shortcuts.open")).toEqual(["Ctrl+?"]);
		expect(labels(browser, "focus.group")).toEqual(["Ctrl+1–9"]);
		const desktop = rowsFor(true, MAC);
		expect(labels(desktop, "workspace.new")).toEqual(["⌘N"]);
		expect(labels(desktop, "tab.close")).toEqual(["⌘W"]);
		expect(labels(desktop, "shortcuts.open")).toEqual(["⌘?"]);
	});

	test("shows desktop-only chords only in the desktop app, for its platform", () => {
		const ids = (rows: readonly ShortcutRow[]) =>
			rows.filter((row) => row.surface === "desktop").map((row) => row.id);
		expect(ids(rowsFor(false, MAC))).toEqual([]);
		expect(ids(rowsFor(true, MAC))).toEqual([
			"desktop.settings",
			"desktop.quit",
			"desktop.zoomIn",
			"desktop.zoomOut",
			"desktop.zoomReset",
			"desktop.minimize",
			"desktop.hide",
			"desktop.hideOthers",
		]);
		const windows = rowsFor(true, WINDOWS);
		expect(ids(windows)).toEqual([
			"desktop.settings",
			"desktop.closeItem",
			"desktop.zoomIn",
			"desktop.zoomOut",
			"desktop.zoomReset",
		]);
		expect(labels(windows, "desktop.settings")).toEqual(["Ctrl+,"]);
		expect(labels(rowsFor(true, LINUX), "desktop.quit")).toEqual(["Ctrl+Q"]);
	});

	test("lists the review surfaces' cursor, comment and composer keys", () => {
		const mac = rowsFor(false, MAC);
		const linux = rowsFor(false, LINUX);
		expect(labels(linux, "review.cursorUp")).toEqual(["↑", "K"]);
		expect(labels(linux, "review.cursorLeft")).toEqual(["←", "H"]);
		expect(labels(linux, "review.extendUp")).toEqual(["Shift+↑", "Shift+K"]);
		expect(labels(mac, "review.extendDown")).toEqual(["⇧↓", "⇧J"]);
		expect(labels(linux, "review.regionResize")).toEqual([
			"Shift+←",
			"Shift+→",
			"Shift+↑",
			"Shift+↓",
		]);
		expect(labels(linux, "review.swipeFar")).toEqual([
			"Shift+←",
			"Shift+→",
			"PgUp",
			"PgDn",
			"Home",
			"End",
		]);
	});

	test("spells feature keys per platform", () => {
		const mac = rowsFor(false, MAC);
		const linux = rowsFor(false, LINUX);
		expect(labels(mac, "review.nextFile")).toEqual(["⌥↓"]);
		expect(labels(linux, "review.nextFile")).toEqual(["Alt+↓"]);
		expect(labels(mac, "review.markViewed")).toEqual(["V"]);
		expect(labels(mac, "search.doubleShift")).toEqual(["⇧⇧"]);
		expect(labels(linux, "search.doubleShift")).toEqual(["Shift+Shift"]);
		expect(labels(mac, "trees.openKept")).toEqual(["⌘↵", "⌘Num ↵"]);
		expect(labels(linux, "group.next")).toEqual(["Ctrl+F6"]);
		expect(labels(mac, "group.next")).toEqual(["⌃F6"]);
		expect(labels(mac, "terminal.copy")).toBeUndefined();
		expect(labels(linux, "terminal.copy")).toEqual(["Ctrl+Shift+C"]);
		expect(labels(mac, "palette.scope")).toEqual(["Tab", "⇧Tab"]);
		expect(labels(linux, "palette.scope")).toEqual(["Tab", "Shift+Tab", "Alt+1–9"]);
	});
});

test("a typed key names the locked element rows that already act on it", () => {
	const ids = (
		key: string,
		shift = false,
		modifiers: { ctrlKey?: boolean; altKey?: boolean } = {},
	) =>
		elementKeyUses(
			{ key, shiftKey: shift, ctrlKey: false, metaKey: false, altKey: false, ...modifiers },
			LINUX,
		).map(({ id }) => id);
	expect(ids("s")).toEqual([]);
	expect(ids("F2")).toEqual([]);
	expect(ids("ArrowDown")).toContain("trees.down");
	expect(ids("Enter")).toContain("trees.open");
	expect(ids("ArrowUp", true)).toContain("review.extendUp");
	expect(ids("ArrowUp", false, { ctrlKey: true })).toEqual([]);
});

test("the Settings surface lists the section list, setting, list and Esc keys", () => {
	const rows = rowsFor(false, LINUX);
	const settings = rows.filter((row) => row.surface === "settings").map((row) => row.id);
	expect(settings).toEqual([
		"settings.nav.up",
		"settings.nav.down",
		"settings.nav.firstLast",
		"settings.nav.enter",
		"settings.nav.open",
		"settings.nav.search",
		"settings.up",
		"settings.down",
		"settings.firstLast",
		"settings.edit",
		"settings.actions",
		"settings.back",
		"settings.change",
		"settings.done",
		"settings.reset",
		"settings.escape",
		"settings.list.open",
		"settings.list.remove",
		"settings.list.menu",
	]);
	expect(labels(rows, "settings.nav.down")).toEqual(["↓", "J"]);
	expect(labels(rows, "settings.nav.search")).toEqual(["S", "/"]);
	expect(labels(rows, "settings.back")).toEqual(["←", "H"]);
	expect(labels(rows, "settings.edit")).toEqual(["↵", "Space"]);
	expect(labels(rows, "settings.done")).toEqual(["↵", "Esc"]);
	expect(labels(rows, "settings.reset")).toEqual(["Delete"]);
	expect(labels(rows, "settings.list.remove")).toEqual(["Delete"]);
	expect(labels(rows, "settings.list.menu")).toEqual(["Shift+F10"]);
	expect(labels(rows, "settings.escape")).toEqual(["Esc"]);
});
