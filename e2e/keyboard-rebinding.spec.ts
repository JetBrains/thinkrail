import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";
import { E2eWire } from "./fixtures/wire";

test.use({ viewport: { width: 1440, height: 900 } });

const editor = (page: Page) => page.getByTestId("keybinding-editor");
const rows = (page: Page) => editor(page).getByTestId("keybinding-row");
const row = (page: Page, command: string) =>
	editor(page).locator(`[data-testid="keybinding-row"][data-command="${command}"]`);
const chord = (page: Page, command: string) => row(page, command).getByTestId("keybinding-chord");
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

async function openSettingsSection(page: Page, section: "keyboard" | "extensions"): Promise<void> {
	if (!(await settings(page).isVisible())) await page.getByTestId("open-settings").click();
	await page.getByTestId(`settings-nav-${section}`).click();
}

async function openKeyboardSettings(page: Page): Promise<void> {
	await openSettingsSection(page, "keyboard");
	await expect(rows(page).first()).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
	await settings(page).getByRole("button", { name: "Close", exact: true }).click();
	await expect(settings(page)).toBeHidden();
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
	const button = chord(page, "group.splitRight");
	await button.focus();
	await page.keyboard.press("Enter");
	await expect(button).toContainText("Press a new shortcut… Esc cancels");
	await page.keyboard.press("Control");
	await expect(button).toContainText("Press a new shortcut… Esc cancels");
	await pressPlatformShortcut(page, "Alt+KeyS");
	await expect(button.locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);
	await expect(row(page, "group.splitRight")).toHaveAttribute("data-custom", "true");
	await expect(row(page, "group.splitRight").getByTestId("keybinding-custom")).toHaveText("Custom");
	await expect(button).toBeFocused();
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
	await expect(chord(page, "group.splitRight")).toBeFocused();
});

test("Replace takes a chord from another command, which then shows unbound; Reset all restores both", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("start-chat").first().click();
	await expect(page.getByTestId("chat-input")).toBeVisible();

	await openKeyboardSettings(page);
	await record(page, "focus.composer", "k");
	await expect(message(page, "focus.composer")).toHaveAttribute("data-kind", "taken");
	await expect(message(page, "focus.composer")).toContainText(
		"Ctrl+K is already used by Open the search palette",
	);
	await message(page, "focus.composer").getByTestId("keybinding-replace").click();
	await expect(chord(page, "focus.composer")).toBeFocused();
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

	await openKeyboardSettings(page);
	await editor(page).getByTestId("keybinding-reset-all").click();
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
	await openKeyboardSettings(page);
	const button = chord(page, "view.toggleLeft");

	await button.click();
	await page.keyboard.press("Shift");
	await expect(button).toContainText("Press a new shortcut… Esc cancels");
	await page.keyboard.press("g");
	await expect(message(page, "view.toggleLeft")).toHaveAttribute("data-kind", "plain");
	await expect(message(page, "view.toggleLeft")).toContainText(
		"A shortcut needs Ctrl, Alt or ⌘, or F1–F12",
	);
	await expect(button).toBeFocused();
	await message(page, "view.toggleLeft").getByTestId("keybinding-dismiss").click();
	await expect(message(page, "view.toggleLeft")).toHaveCount(0);
	await expect(button).toBeFocused();

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
	await expect(button).toBeFocused();

	await page.keyboard.press("Enter");
	await page.keyboard.press("Tab");
	await expect(button).not.toBeFocused();
	await expect(button.locator("kbd")).toHaveText(["Ctrl", "B"]);

	await button.focus();
	await page.keyboard.press("ArrowDown");
	await expect(chord(page, "view.toggleRight")).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(button).toBeFocused();

	const locked = chord(page, "trees.search");
	await expect(row(page, "trees.search")).toHaveAttribute("data-locked", "true");
	await expect(locked).toHaveAttribute("aria-disabled", "true");
	await expect(locked).toContainText("Locked");
	await locked.focus();
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
		await openKeyboardSettings(other);
		await expect(chord(other, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "\\"]);

		await openKeyboardSettings(page);
		await record(page, "group.splitRight", "Alt+KeyS");
		await expect(chord(page, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);

		await expect(chord(other, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);
		await expect(row(other, "group.splitRight")).toHaveAttribute("data-custom", "true");
		await other.reload();
		await expect(other.getByTestId("connection-status")).toHaveAttribute(
			"data-status",
			"connected",
		);
		await openKeyboardSettings(other);
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
		locked: true,
		keys: ["S"],
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
					{ command: "trees.search", chords: ["Mod+KeyF"], locked: true },
					{ command: "old-extension.run", chords: ["Mod+Shift+KeyR"] },
					{ command: "search.open", chords: ["Mod+KeyK"] },
				],
			}),
		),
	});
	const summary = page.getByTestId("keybinding-import-dialog");
	await expect(summary).toBeVisible();
	await expect(summary.getByRole("heading", { name: "Import crafted.json" })).toBeVisible();
	await expect(summary.getByTestId("keybinding-import-changes")).toContainText("Will change (1)");
	await expect(summary.getByTestId("keybinding-import-changes").locator("li")).toHaveText([
		"Split right: Ctrl+\\ → Ctrl+Alt+S",
	]);
	await expect(summary.getByTestId("keybinding-import-conflicts")).toContainText("Conflicts (0)");
	await expect(summary.getByTestId("keybinding-import-skipped").locator("li")).toHaveText([
		"Search the visible rows — an element key, locked",
		"old-extension.run — unknown command (is its extension installed?)",
	]);
	await expect(summary.getByTestId("keybinding-import-unchanged")).toHaveText(
		"Unchanged: 1. Other shortcuts are not touched.",
	);
	await summary.getByRole("button", { name: "Apply 1 change" }).click();
	await expect(summary).toHaveCount(0);
	await expect(row(page, "group.splitRight")).toHaveAttribute("data-custom", "true");
	await expect(chord(page, "group.splitRight").locator("kbd")).toHaveText(["Ctrl", "Alt", "S"]);
});

test("a ThinkRail chord over an extension's marks the extension's chord inactive while F still starts hint mode", async ({
	page,
}) => {
	await openFixtureProject(page);
	await setHintMode(page, false);
	await openKeyboardSettings(page);
	const hintSection = editor(page).locator(
		'[data-testid="keybinding-section"][data-section="hint-mode"]',
	);
	await expect(hintSection).toHaveAttribute("data-enabled", "false");
	await expect(hintSection.getByRole("heading")).toContainText("Hint mode");
	await expect(hintSection.getByRole("heading")).toContainText("Extension");
	await expect(hintSection.getByRole("heading")).toContainText("Off");
	await expect(chord(page, "hint-mode.show")).not.toHaveAttribute("aria-disabled", "true");

	await record(page, "search.open", "Semicolon");
	await expect(message(page, "search.open")).toHaveCount(0);
	await expect(chord(page, "search.open").locator("kbd")).toHaveText(["Ctrl", ";"]);

	await setHintMode(page, true);
	await openKeyboardSettings(page);
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
