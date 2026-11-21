import { realpathSync, rmSync, utimesSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	closeSettings,
	enterDefaultWorkspace,
	openFixtureProject,
	openSettingsSection,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";
import { seedWorkspaceSession } from "./fixtures/sessions";
import { E2eWire } from "./fixtures/wire";

test.use({ viewport: { width: 1440, height: 900 } });

const editor = (page: Page) => page.getByTestId("keybinding-editor");
const rows = (page: Page) => editor(page).getByTestId("keybinding-row");
const row = (page: Page, command: string) =>
	editor(page).locator(`[data-testid="keybinding-row"][data-command="${command}"]`);
const chord = (page: Page, command: string) => row(page, command).getByTestId("keybinding-chord");
const area = (page: Page, id: string) =>
	editor(page).locator(`[data-testid="keybinding-group"][data-area="${id}"]`);
const message = (page: Page, command: string) =>
	row(page, command).getByTestId("keybinding-message");
const settings = (page: Page) => page.getByTestId("settings-dialog");

async function withHostWire<T>(page: Page, run: (wire: E2eWire) => Promise<T>): Promise<T> {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		return await run(wire);
	} finally {
		wire.close();
	}
}

test.afterEach(async ({ page }) => {
	if (page.isClosed() || !page.url().startsWith("http")) return;
	await withHostWire(page, async (wire) => {
		const { disabledExtensions } = await wire.request("settings.update", { config: {} });
		await wire.request("settings.update", {
			config: {
				keybindings: {},
				disabledExtensions: disabledExtensions.filter((name) => name !== "hint-mode"),
			},
		});
	});
});

/** Areas start collapsed: a row renders once its area is open (or a filter matches it). */
async function openKeyboardSettings(page: Page, ...areas: string[]): Promise<void> {
	await openSettingsSection(page, "keyboard");
	await expect(area(page, "general")).toBeVisible();
	for (const id of areas) await openArea(page, id);
}

async function openArea(page: Page, id: string): Promise<void> {
	const group = area(page, id);
	if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
	await expect(group).toHaveAttribute("aria-expanded", "true");
}

async function openEveryArea(page: Page): Promise<void> {
	const collapsed = editor(page).locator('[data-testid="keybinding-group"][aria-expanded="false"]');
	for (let left = await collapsed.count(); left > 0; left = await collapsed.count()) {
		await collapsed.first().click();
		await expect(collapsed).toHaveCount(left - 1);
	}
}

async function record(page: Page, command: string, keys: string): Promise<void> {
	const button = chord(page, command);
	await button.click();
	await expect(button).toContainText("Press a new shortcut… Esc cancels");
	await pressPlatformShortcut(page, keys);
}

async function setHintMode(page: Page, enabled: boolean): Promise<void> {
	await openSettingsSection(page, "extensions");
	const toggle = page.getByTestId("extension-toggle-hint-mode");
	if ((await toggle.getAttribute("aria-checked")) !== String(enabled)) await toggle.click();
	await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
}

async function openCheatsheet(page: Page): Promise<Locator> {
	await page.getByTestId("left-layout-rail").getByTestId("open-shortcuts").click();
	const dialog = page.getByTestId("shortcuts-dialog");
	await expect(dialog).toBeVisible();
	return dialog;
}

test("a recorded chord runs its command, shows in the cheatsheet and the palette, and Reset restores the default", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");
	for (const name of ["README.md", "notes.txt"]) {
		await page.getByTestId("file-node").filter({ hasText: name }).dblclick();
	}
	await expect(page.getByTestId("editor-tab")).toHaveCount(2);

	await openKeyboardSettings(page);
	await editor(page).getByTestId("keybinding-filter").fill("split right");
	await expect(rows(page)).toHaveCount(1);
	const item = row(page, "group.splitRight");
	const button = chord(page, "group.splitRight");
	await item.focus();
	await expect(button).toHaveCSS("outline-style", "none");
	await page.keyboard.press("Enter");
	await expect(button).toContainText("Press a new shortcut… Esc cancels");
	await expect(button).toHaveCSS("outline-style", "solid");
	await page.keyboard.press("Control");
	await expect(button).toContainText("Press a new shortcut… Esc cancels");
	await pressPlatformShortcut(page, "Alt+KeyS");
	await expect(button.locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);
	await expect(button).toHaveCSS("outline-style", "none");
	await expect(item).toHaveAttribute("data-custom", "true");
	await expect(item.getByTestId("keybinding-custom")).toHaveText("Changed");
	await expect(item.getByTestId("keybinding-default")).toHaveText("Default: Ctrl+\\");
	await expect(area(page, "tabs").getByTestId("keybinding-group-changed")).toHaveText("1 changed");
	await expect(item).toBeFocused();
	await closeSettings(page);

	await page.getByRole("tab", { name: /notes\.txt/ }).click();
	await pressPlatformShortcut(page, "k");
	await page.getByTestId("search-input").fill(">split right");
	const paletteRow = page.locator(
		'[data-testid="search-row"][data-item-id="command:group.splitRight"]',
	);
	await expect(paletteRow.locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("search-palette")).toHaveCount(0);

	const groups = page.getByTestId("center-group");
	await expect(groups).toHaveCount(1);
	await page.getByRole("tab", { name: /notes\.txt/ }).click();
	await pressPlatformShortcut(page, "Backslash");
	await expect(groups).toHaveCount(1);
	await pressPlatformShortcut(page, "Alt+KeyS");
	await expect(groups).toHaveCount(2);

	const cheatsheet = await openCheatsheet(page);
	await cheatsheet.getByTestId("shortcuts-filter").fill("split right");
	await expect(cheatsheet.getByTestId("shortcuts-row").locator("kbd")).toHaveText([
		"Ctrl",
		"Alt",
		"S",
	]);
	await page.keyboard.press("Escape");
	await expect(cheatsheet).toHaveCount(0);

	await openKeyboardSettings(page);
	await editor(page).getByTestId("keybinding-filter").fill("split right");
	await row(page, "group.splitRight").getByTestId("keybinding-reset").click();
	await expect(row(page, "group.splitRight")).not.toHaveAttribute("data-custom", "true");
	await expect(chord(page, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "\\"]);
	await expect(row(page, "group.splitRight")).toBeFocused();
});

test("the shortcut tree starts collapsed, opens with the arrows and the filter, and Delete puts back defaults", async ({
	page,
}) => {
	await openFixtureProject(page);
	await withHostWire(page, (wire) =>
		wire.request("settings.update", {
			config: {
				keybindings: { "group.splitRight": ["Mod+Alt+KeyS"], "tab.close": ["Mod+Alt+KeyQ"] },
			},
		}),
	);
	await openKeyboardSettings(page);
	await expect(
		editor(page).locator('[data-testid="keybinding-group"][aria-expanded="true"]'),
	).toHaveCount(0);
	await expect(rows(page)).toHaveCount(0);
	const tabs = area(page, "tabs");
	await expect(tabs.getByTestId("keybinding-group-changed")).toHaveText("2 changed");
	await expect(tabs.getByTestId("keybinding-group-count")).toHaveText(/^\d+ shortcuts$/);

	await tabs.focus();
	await page.keyboard.press("ArrowRight");
	await expect(tabs).toHaveAttribute("aria-expanded", "true");
	await page.keyboard.press("ArrowRight");
	await expect(rows(page).first()).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(tabs).toBeFocused();

	const split = row(page, "group.splitRight");
	await split.focus();
	await page.keyboard.press("ArrowRight");
	await expect(split.getByTestId("keybinding-change")).toBeFocused();
	await page.keyboard.press("ArrowLeft");
	await expect(split).toBeFocused();
	await page.keyboard.press("Delete");
	await expect(split).not.toHaveAttribute("data-custom", "true");
	await expect(chord(page, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "\\"]);
	await expect(tabs.getByTestId("keybinding-group-changed")).toHaveText("1 changed");

	await tabs.focus();
	await page.keyboard.press("Delete");
	await expect(tabs.getByTestId("keybinding-group-changed")).toHaveCount(0);
	await expect(row(page, "tab.close")).not.toHaveAttribute("data-custom", "true");
	await page.keyboard.press("ArrowLeft");
	await expect(tabs).toHaveAttribute("aria-expanded", "false");

	const filter = editor(page).getByTestId("keybinding-filter");
	await filter.fill("next file");
	const sections = editor(page).getByTestId("keybinding-section");
	await expect(sections).toHaveCount(1);
	await expect(sections.first()).toHaveAttribute("data-section", "review");
	await expect(area(page, "review")).toHaveAttribute("aria-expanded", "true");
	await page.keyboard.press("Escape");
	await expect(filter).toHaveValue("");
	await expect(
		editor(page).locator('[data-testid="keybinding-group"][aria-expanded="true"]'),
	).toHaveCount(0);
});

test("Replace takes a chord from another command, which then shows unbound; Reset all restores both", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("start-chat").first().click();
	await expect(page.getByTestId("chat-input")).toBeVisible();

	await openKeyboardSettings(page, "general");
	await record(page, "focus.composer", "k");
	await expect(message(page, "focus.composer")).toHaveAttribute("data-kind", "taken");
	await expect(message(page, "focus.composer")).toContainText(
		"Ctrl+K is already used by Open the search palette",
	);
	await message(page, "focus.composer").getByTestId("keybinding-replace").click();
	await expect(row(page, "focus.composer")).toBeFocused();
	await expect(chord(page, "focus.composer").locator("kbd")).toHaveText(["Ctrl", "K"]);
	await expect(chord(page, "search.open")).toHaveText("Not assigned");
	await expect(row(page, "search.open")).toHaveAttribute("data-custom", "true");
	await expect(page.getByTestId("settings-keyboard")).toContainText(
		"Search opens from the search button in the top bar.",
	);
	await closeSettings(page);

	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("chat-input")).toBeFocused();
	await expect(page.getByTestId("search-palette")).toHaveCount(0);

	await openKeyboardSettings(page, "general");
	await expect(editor(page).locator('[data-custom="true"]')).toHaveCount(2);
	await editor(page).getByTestId("keybinding-reset-all").click();
	await page.getByTestId("keybinding-reset-all-confirm").click();
	await expect(editor(page).locator('[data-custom="true"]')).toHaveCount(0);
	await expect(chord(page, "focus.composer").locator("kbd")).toHaveText(["Ctrl", "L"]);
	await expect(chord(page, "search.open").locator("kbd")).toHaveText(["Ctrl", "K"]);
	await expect(page.getByTestId("settings-keyboard")).toContainText(
		"Search opens with Ctrl+K everywhere.",
	);
});

test("a plain key asks for a modifier, a desktop or browser chord is refused or warned, and Esc or Tab cancel", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openKeyboardSettings(page, "panels", "trees");
	const item = row(page, "view.toggleLeft");
	const button = chord(page, "view.toggleLeft");

	await button.click();
	await page.keyboard.press("Shift");
	await expect(button).toContainText("Press a new shortcut… Esc cancels");
	await page.keyboard.press("g");
	await expect(message(page, "view.toggleLeft")).toHaveAttribute("data-kind", "plain");
	await expect(message(page, "view.toggleLeft")).toContainText(
		"A shortcut needs Ctrl, Alt or ⌘, or F1–F12",
	);
	await expect(item).toBeFocused();
	await message(page, "view.toggleLeft").getByTestId("keybinding-dismiss").click();
	await expect(message(page, "view.toggleLeft")).toHaveCount(0);
	await expect(item).toBeFocused();

	await page.keyboard.press("Enter");
	await pressPlatformShortcut(page, "t");
	await expect(message(page, "view.toggleLeft")).toHaveAttribute("data-kind", "reserved");
	await expect(message(page, "view.toggleLeft")).toContainText(
		"Your browser keeps Ctrl+T; it only works in the desktop app",
	);
	await message(page, "view.toggleLeft").getByTestId("keybinding-cancel").click();
	await expect(button.locator("kbd")).toHaveText(["Ctrl", "B"]);

	await page.keyboard.press("Enter");
	await pressPlatformShortcut(page, "Comma");
	await expect(message(page, "view.toggleLeft")).toHaveAttribute("data-kind", "desktop");
	await expect(message(page, "view.toggleLeft")).toContainText(
		"Ctrl+, is used by the ThinkRail desktop app",
	);

	await page.keyboard.press("Enter");
	await expect(message(page, "view.toggleLeft")).toHaveCount(0);
	await expect(button).toContainText("Press a new shortcut… Esc cancels");
	await page.keyboard.press("Escape");
	await expect(settings(page)).toBeVisible();
	await expect(button.locator("kbd")).toHaveText(["Ctrl", "B"]);
	await expect(item).toBeFocused();

	await page.keyboard.press("Enter");
	await page.keyboard.press("Tab");
	await expect(item).not.toBeFocused();
	await expect(button.locator("kbd")).toHaveText(["Ctrl", "B"]);

	await item.focus();
	await page.keyboard.press("ArrowDown");
	await expect(row(page, "view.toggleRight")).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(item).toBeFocused();

	const locked = chord(page, "trees.firstLast");
	await expect(row(page, "trees.firstLast")).toHaveAttribute("data-locked", "true");
	await expect(row(page, "trees.firstLast")).toHaveAttribute("aria-disabled", "true");
	await expect(locked).toContainText("Locked");
	await row(page, "trees.firstLast").focus();
	await page.keyboard.press("Enter");
	await expect(locked).not.toContainText("Press a new shortcut");
	await expect(editor(page).locator('[data-custom="true"]')).toHaveCount(0);
});

test("another page on the same host shows an override after the broadcast, and a reload keeps it", async ({
	page,
	context,
}) => {
	await openFixtureProject(page);
	const other = await context.newPage();
	try {
		await other.goto(page.url());
		await expect(other.getByTestId("connection-status")).toHaveAttribute(
			"data-status",
			"connected",
		);
		await openKeyboardSettings(other, "tabs");
		await expect(chord(other, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "\\"]);

		await openKeyboardSettings(page, "tabs");
		await record(page, "group.splitRight", "Alt+KeyS");
		await expect(chord(page, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);

		await expect(chord(other, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);
		await expect(row(other, "group.splitRight")).toHaveAttribute("data-custom", "true");
		await other.reload();
		await expect(other.getByTestId("connection-status")).toHaveAttribute(
			"data-status",
			"connected",
		);
		await openKeyboardSettings(other, "tabs");
		await expect(chord(other, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);
	} finally {
		await other.close();
	}
});

test("Export downloads every row, locked ones included, and Import summarizes a file before applying it", async ({
	page,
}) => {
	await openFixtureProject(page);
	await openKeyboardSettings(page);
	await expect(rows(page)).toHaveCount(0);
	await openEveryArea(page);
	const total = await rows(page).count();
	await expect(editor(page).getByTestId("keybinding-count")).toHaveText(`${total} shortcuts`);

	const download = page.waitForEvent("download");
	await editor(page).getByTestId("keybinding-export").click();
	const file = await download;
	expect(file.suggestedFilename()).toBe("thinkrail-keybindings.json");
	const exported = JSON.parse(await readFile(await file.path(), "utf8"));
	expect([exported.format, exported.version, exported.bindings.length]).toEqual([
		"thinkrail-keybindings",
		1,
		total,
	]);
	const binding = (command: string) =>
		exported.bindings.find((entry: { command: string }) => entry.command === command);
	expect(binding("trees.search")).toEqual({
		command: "trees.search",
		title: "Search the visible rows",
		source: "thinkrail",
		scope: "trees",
		chords: ["KeyS"],
		defaults: ["KeyS"],
		changed: false,
	});
	expect(binding("trees.down")).toMatchObject({
		scope: "trees",
		alias: "arrows.down",
		fixed: { keys: ["↓"], locked: true },
		chords: ["KeyJ"],
	});
	expect(binding("trees.firstLast")).toMatchObject({
		scope: "trees",
		locked: true,
		keys: ["Home", "End"],
	});
	expect(binding("group.splitRight")).toEqual({
		command: "group.splitRight",
		title: "Split right",
		source: "thinkrail",
		chords: ["Mod+Backslash"],
		defaults: ["Mod+Backslash"],
		changed: false,
	});
	expect(binding("shortcuts.open")).toMatchObject({ chords: ["Mod+?"], defaults: ["Mod+?"] });
	expect(binding("hint-mode.show")).toMatchObject({
		source: "hint-mode",
		chords: ["KeyF", "Mod+Semicolon"],
	});

	const input = editor(page).getByTestId("keybinding-import-input");
	await input.setInputFiles({
		name: "notes.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify({ format: "something-else" })),
	});
	await expect(page.getByTestId("toast")).toContainText("This is not a ThinkRail keybindings file");

	await input.setInputFiles({
		name: "crafted.json",
		mimeType: "application/json",
		buffer: Buffer.from(
			JSON.stringify({
				format: "thinkrail-keybindings",
				version: 1,
				bindings: [
					{ command: "group.splitRight", chords: ["Mod+Alt+KeyS"] },
					{ command: "trees.firstLast", chords: ["Mod+KeyF"], locked: true },
					{ command: "old-extension.run", chords: ["Mod+Shift+KeyR"] },
					{ command: "search.open", chords: ["Mod+KeyK"] },
					{ command: "trees.search", scope: "trees", chords: ["KeyG"] },
					{ command: "transcript.copy", scope: "transcript", chords: ["ArrowDown"] },
				],
			}),
		),
	});
	const summary = page.getByTestId("keybinding-import-dialog");
	await expect(summary).toBeVisible();
	await expect(summary.getByRole("heading", { name: "Import crafted.json" })).toBeVisible();
	await expect(summary.getByTestId("keybinding-import-changes")).toContainText("Will change (2)");
	await expect(summary.getByTestId("keybinding-import-changes").locator("li")).toHaveText([
		"Split right: Ctrl+\\ → Ctrl+Alt+S",
		"Search the visible rows: S → G",
	]);
	await expect(summary.getByTestId("keybinding-import-conflicts")).toContainText("Conflicts (0)");
	await expect(summary.getByTestId("keybinding-import-skipped").locator("li")).toHaveText([
		"Go to the first or last row — an element key, locked",
		"old-extension.run — unknown command (is its extension installed?)",
		"Copy the message, thought or tool output — a navigation key, locked",
	]);
	await expect(summary.getByTestId("keybinding-import-unchanged")).toHaveText(
		"Unchanged: 1. Other shortcuts are not touched.",
	);
	await summary.getByRole("button", { name: "Apply 2 changes" }).click();
	await expect(summary).toHaveCount(0);
	await expect(row(page, "group.splitRight")).toHaveAttribute("data-custom", "true");
	await expect(chord(page, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);
	await expect(chord(page, "trees.search").locator("kbd")).toHaveText(["G"]);
});

test("a switched-off extension's command records Ctrl+K without a warning, and search keeps it", async ({
	page,
}) => {
	await openFixtureProject(page);
	await setHintMode(page, false);
	await openKeyboardSettings(page, "general", "hint-mode");

	await record(page, "hint-mode.show", "k");
	await expect(message(page, "hint-mode.show")).toHaveCount(0);
	await expect(chord(page, "hint-mode.show").locator("kbd")).toHaveText(["Ctrl", "K"]);
	await expect(row(page, "search.open")).not.toHaveAttribute("data-custom", "true");
	await expect(chord(page, "search.open").locator("kbd")).toHaveText(["Ctrl", "K"]);
	await closeSettings(page);

	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("search-palette")).toBeVisible();
});

test("a ThinkRail chord over an extension's marks the extension's chord inactive while F still starts hint mode", async ({
	page,
}) => {
	await openFixtureProject(page);
	await setHintMode(page, false);
	await openKeyboardSettings(page, "general", "hint-mode");
	const hintSection = editor(page).locator(
		'[data-testid="keybinding-section"][data-section="hint-mode"]',
	);
	await expect(hintSection).toHaveAttribute("data-enabled", "false");
	await expect(area(page, "hint-mode")).toContainText("Hint mode");
	await expect(area(page, "hint-mode")).toContainText("Extension");
	await expect(area(page, "hint-mode")).toContainText("Off");
	await expect(row(page, "hint-mode.show")).not.toHaveAttribute("aria-disabled", "true");

	await record(page, "search.open", "Semicolon");
	await expect(message(page, "search.open")).toHaveCount(0);
	await expect(chord(page, "search.open").locator("kbd")).toHaveText(["Ctrl", ";"]);

	await setHintMode(page, true);
	await openKeyboardSettings(page, "hint-mode");
	const conflict = row(page, "hint-mode.show").getByTestId("keybinding-conflict");
	await expect(conflict).toHaveText("Ctrl+; is taken by Open the search palette — inactive");
	await expect(row(page, "hint-mode.show").getByTestId("keybinding-assign-another")).toBeVisible();
	await closeSettings(page);

	const cheatsheet = await openCheatsheet(page);
	const cheatsheetRow = cheatsheet.locator('[data-shortcut="hint-mode.show"]');
	await expect(cheatsheetRow.getByTestId("shortcuts-conflict")).toHaveText(
		"inactive: taken by Open the search palette",
	);
	await page.keyboard.press("Escape");
	await expect(cheatsheet).toHaveCount(0);

	await pressPlatformShortcut(page, "Semicolon");
	await expect(page.getByTestId("search-palette")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("search-palette")).toHaveCount(0);

	await page.getByTestId("project-name").first().focus();
	await page.keyboard.press("f");
	await expect(page.getByTestId("hint-mode")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("hint-mode")).toHaveCount(0);
});

async function recordLocal(page: Page, command: string, key: string): Promise<void> {
	const button = chord(page, command);
	await button.click();
	await expect(button).toContainText("Press a key or a chord… Esc cancels");
	await page.keyboard.press(key);
}

async function focusFilesTree(page: Page): Promise<Locator> {
	await revealWorkbenchTool(page, "files");
	const item = page.getByRole("tree", { name: "Files" }).getByRole("treeitem").first();
	await item.focus();
	return item;
}

test("a tree's search rebound to F warns about hint mode; inside the tree F searches and hint mode yields", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openKeyboardSettings(page);
	const trees = editor(page).locator('[data-testid="keybinding-section"][data-section="trees"]');
	await expect(trees.getByTestId("keybinding-scope").first()).toContainText(
		"when focus is in a sidebar tree",
	);
	await openArea(page, "trees");
	await openArea(page, "hint-mode");
	await expect(row(page, "trees.down").getByTestId("keybinding-fixed")).toContainText(
		"always works",
	);

	await recordLocal(page, "trees.search", "f");
	await expect(message(page, "trees.search")).toHaveAttribute("data-kind", "shadow");
	await expect(message(page, "trees.search")).toContainText(
		"F runs “Label everything you can click (hint mode)” everywhere else; inside sidebar trees it will run “Search the visible rows” instead",
	);
	await message(page, "trees.search").getByTestId("keybinding-assign-anyway").click();
	await expect(chord(page, "trees.search").locator("kbd")).toHaveText(["F"]);
	await expect(row(page, "trees.search")).toHaveAttribute("data-custom", "true");
	await expect(row(page, "hint-mode.show").getByTestId("keybinding-yields")).toHaveText(
		"Inside sidebar trees, F runs “Search the visible rows”",
	);
	await closeSettings(page);

	const item = await focusFilesTree(page);
	await page.keyboard.press("f");
	await expect(page.getByTestId("tree-search")).toBeFocused();
	await expect(page.getByTestId("hint-mode")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(item).toBeFocused();
	await page.keyboard.press("s");
	await expect(page.getByTestId("tree-search")).toHaveCount(0);

	await page.getByTestId("open-search").focus();
	await page.keyboard.press("f");
	await expect(page.getByTestId("hint-mode")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("hint-mode")).toHaveCount(0);
});

test("inside a scope a local key conflicts with its neighbours only: Replace, a plain letter, a refused arrow", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await openKeyboardSettings(page, "trees", "transcript");

	await recordLocal(page, "trees.search", "ArrowDown");
	await expect(message(page, "trees.search")).toHaveAttribute("data-kind", "primitive");
	await expect(message(page, "trees.search")).toContainText(
		"↓ is a navigation key — locked in every element",
	);
	await message(page, "trees.search").getByTestId("keybinding-dismiss").click();
	await expect(chord(page, "trees.search").locator("kbd")).toHaveText(["S"]);

	await recordLocal(page, "trees.search", "c");
	await expect(message(page, "trees.search")).toHaveAttribute("data-kind", "note");
	await expect(message(page, "trees.search")).toContainText(
		"C also acts in the chat transcript and Ask user question — different elements, so no conflict",
	);
	await expect(chord(page, "trees.search").locator("kbd")).toHaveText(["C"]);

	await recordLocal(page, "trees.search", "j");
	await expect(message(page, "trees.search")).toHaveAttribute("data-kind", "takenInScope");
	await expect(message(page, "trees.search")).toContainText(
		"J is already used by Move down (alias) inside sidebar trees",
	);
	await message(page, "trees.search").getByTestId("keybinding-replace").click();
	await expect(chord(page, "trees.search").locator("kbd")).toHaveText(["J"]);
	await expect(row(page, "trees.down").getByTestId("keybinding-conflict")).toHaveText(
		"J is taken by Search the visible rows — inactive",
	);
	await expect(row(page, "transcript.down").getByTestId("keybinding-conflict")).toHaveCount(0);
	await expect(chord(page, "transcript.down").locator("kbd")).toHaveText(["J"]);

	await recordLocal(page, "trees.search", "g");
	await expect(message(page, "trees.search")).toHaveCount(0);
	await expect(chord(page, "trees.search").locator("kbd")).toHaveText(["G"]);
	await closeSettings(page);

	const item = await focusFilesTree(page);
	await page.keyboard.press("g");
	await expect(page.getByTestId("tree-search")).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(item).toBeFocused();
	await page.keyboard.press("j");
	await expect(item).not.toBeFocused();
	await page.keyboard.press("k");
	await expect(item).toBeFocused();
});

test("Replace on a shared twin's key clears every element holding it, so it moves down in the tree and the transcript", async ({
	page,
}) => {
	await openFixtureProject(page);
	const at = 1_701_400_000_000;
	const session = seedWorkspaceSession(realpathSync(E2E_FIXTURE_REPO), {
		name: "twin keys",
		messages: [
			{ role: "user", text: "First twin question.", timestamp: at },
			{ role: "assistant", text: "First twin answer.", stopReason: "stop", timestamp: at + 1_000 },
		],
	});
	utimesSync(session.path, new Date(at + 50_000), new Date(at + 50_000));
	try {
		await enterDefaultWorkspace(page);
		const transcriptRow = (text: string) =>
			page.locator("[data-chat-row-id]").filter({ hasText: text });
		await expect(transcriptRow("First twin answer.")).toBeVisible();
		await withHostWire(page, (wire) =>
			wire.request("settings.update", {
				config: { keybindings: { "trees.search": ["KeyX"], "transcript.copy": ["KeyX"] } },
			}),
		);
		await openKeyboardSettings(page, "trees", "transcript");
		await expect(chord(page, "trees.search").locator("kbd")).toHaveText(["X"]);

		const down = chord(page, "trees.down");
		await down.click();
		await expect(down).toContainText("Press a new key for the alias… Esc cancels");
		await page.keyboard.press("x");
		await expect(message(page, "trees.down")).toHaveAttribute("data-kind", "takenInScope");
		await expect(message(page, "trees.down")).toContainText(
			"X is already used by Search the visible rows inside sidebar trees and Copy the message, thought or tool output inside the chat transcript",
		);
		await message(page, "trees.down").getByTestId("keybinding-replace").click();
		await expect(down.locator("kbd")).toHaveText(["X"]);
		await expect(chord(page, "trees.search")).toHaveText("Not assigned");
		await expect(chord(page, "transcript.copy")).toHaveText("Not assigned");
		await expect(chord(page, "transcript.down").locator("kbd")).toHaveText(["X"]);
		await closeSettings(page);

		const item = await focusFilesTree(page);
		await page.keyboard.press("x");
		await expect(item).not.toBeFocused();
		await expect(page.getByTestId("tree-search")).toHaveCount(0);

		await page.getByTestId("chat-input").focus();
		await pressPlatformShortcut(page, "ArrowUp");
		await page.keyboard.press("Home");
		await expect(transcriptRow("First twin question.")).toBeFocused();
		await page.keyboard.press("x");
		await expect(transcriptRow("First twin answer.")).toBeFocused();
	} finally {
		rmSync(session.path, { force: true });
	}
});
