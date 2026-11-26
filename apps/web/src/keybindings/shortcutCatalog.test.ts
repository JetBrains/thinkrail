import { describe, expect, test } from "bun:test";
import { EN } from "@thinkrail/locales";
import {
	KEYBINDINGS,
	type KeybindingId,
	SHORTCUT_CATALOG,
	SHORTCUT_SURFACE_TITLES,
	SHORTCUT_SURFACES,
	shortcutRows,
} from ".";

const MAC = "MacIntel";
const LINUX = "Linux x86_64";
const WINDOWS = "Win32";

const labels = (rows: ReturnType<typeof shortcutRows>, id: string) =>
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
		const rows = shortcutRows({ desktop: false, platform: LINUX });
		expect(labels(rows, "rail.move")).toEqual(["↑", "↓", "Home", "End"]);
		expect(labels(rows, "rail.moveBottom")).toEqual(["←", "→", "Home", "End"]);
		expect(labels(rows, "rail.reorder")).toEqual(["Alt+Shift+↑", "Alt+Shift+↓"]);
		expect(labels(rows, "rail.reorderBottom")).toEqual(["Alt+Shift+←", "Alt+Shift+→"]);
	});

	test("takes table chords from the table, never chords a browser does not deliver", () => {
		const browser = shortcutRows({ desktop: false, platform: LINUX });
		expect(labels(browser, "workspace.new")).toEqual(["Ctrl+Alt+N"]);
		expect(labels(browser, "tab.close")).toEqual(["Ctrl+Alt+W"]);
		expect(labels(browser, "shortcuts.open")).toEqual(["Ctrl+?"]);
		expect(labels(browser, "focus.group")).toEqual(["Ctrl+1–9"]);
		const desktop = shortcutRows({ desktop: true, platform: MAC });
		expect(labels(desktop, "workspace.new")).toEqual(["⌘N"]);
		expect(labels(desktop, "tab.close")).toEqual(["⌘W"]);
		expect(labels(desktop, "shortcuts.open")).toEqual(["⌘?"]);
	});

	test("shows desktop-only chords only in the desktop app, for its platform", () => {
		const ids = (rows: ReturnType<typeof shortcutRows>) =>
			rows.filter((row) => row.surface === "desktop").map((row) => row.id);
		expect(ids(shortcutRows({ desktop: false, platform: MAC }))).toEqual([]);
		expect(ids(shortcutRows({ desktop: true, platform: MAC }))).toEqual([
			"desktop.settings",
			"desktop.quit",
			"desktop.zoomIn",
			"desktop.zoomOut",
			"desktop.zoomReset",
			"desktop.minimize",
			"desktop.hide",
			"desktop.hideOthers",
		]);
		const windows = shortcutRows({ desktop: true, platform: WINDOWS });
		expect(ids(windows)).toEqual([
			"desktop.settings",
			"desktop.closeItem",
			"desktop.zoomIn",
			"desktop.zoomOut",
			"desktop.zoomReset",
		]);
		expect(labels(windows, "desktop.settings")).toEqual(["Ctrl+,"]);
		expect(labels(shortcutRows({ desktop: true, platform: LINUX }), "desktop.quit")).toEqual([
			"Ctrl+Q",
		]);
	});

	test("spells feature keys per platform", () => {
		const mac = shortcutRows({ desktop: false, platform: MAC });
		const linux = shortcutRows({ desktop: false, platform: LINUX });
		expect(labels(mac, "review.nextFile")).toEqual(["⌥↓"]);
		expect(labels(linux, "review.nextFile")).toEqual(["Alt+↓"]);
		expect(labels(mac, "review.markViewed")).toEqual(["V"]);
		expect(labels(mac, "search.doubleShift")).toEqual(["⇧⇧"]);
		expect(labels(linux, "search.doubleShift")).toEqual(["Shift+Shift"]);
		expect(labels(mac, "trees.openKept")).toEqual(["⌘↵"]);
		expect(labels(linux, "group.next")).toEqual(["Ctrl+F6"]);
		expect(labels(mac, "group.next")).toEqual(["⌃F6"]);
		expect(labels(mac, "terminal.copy")).toBeUndefined();
		expect(labels(linux, "terminal.copy")).toEqual(["Ctrl+Shift+C"]);
		expect(labels(mac, "palette.scope")).toEqual(["Tab", "⇧Tab"]);
		expect(labels(linux, "palette.scope")).toEqual(["Tab", "Shift+Tab", "Alt+1–9"]);
	});
});
