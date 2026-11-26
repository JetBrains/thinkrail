import { expect, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";

const dialog = (page: Page) => page.getByTestId("shortcuts-dialog");
const firstSection = (page: Page) => dialog(page).getByTestId("shortcuts-section").first();

async function pressShortcutsChord(page: Page): Promise<void> {
	await pressPlatformShortcut(page, "Shift+Slash");
}

test("Mod+? opens the cheatsheet on the typed ?, and Mod+? or Escape close it with focus returned", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.evaluate(() => {
		window.addEventListener("keydown", (event) => Reflect.set(window, "lastKey", event.key), true);
	});
	const project = page.getByTestId("project-name").first();
	await project.focus();

	await pressShortcutsChord(page);
	expect(await page.evaluate(() => Reflect.get(window, "lastKey"))).toBe("?");
	await expect(dialog(page)).toBeVisible();
	await expect(dialog(page).getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
	await expect(page.getByTestId("shortcuts-filter")).toBeFocused();
	await expect(firstSection(page)).toHaveAttribute("data-surface", "trees");

	await pressShortcutsChord(page);
	await expect(dialog(page)).toHaveCount(0);
	await expect(project).toBeFocused();

	await pressShortcutsChord(page);
	await expect(dialog(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog(page)).toHaveCount(0);
	await expect(project).toBeFocused();
});

test("the left rail's keyboard icon opens it with General first and shows its chord", async ({
	page,
}) => {
	await openFixtureProject(page);
	const icon = page.getByTestId("left-layout-rail").getByTestId("open-shortcuts");
	await icon.hover();
	await expect(page.getByRole("tooltip")).toHaveText(/Keyboard shortcuts\s*Ctrl\s*\?/);
	await icon.click();
	await expect(dialog(page)).toBeVisible();
	await expect(firstSection(page)).toHaveAttribute("data-surface", "general");
	await page.keyboard.press("Escape");
	await expect(dialog(page)).toHaveCount(0);
	await expect(icon).toBeFocused();

	await enterDefaultWorkspace(page);
	const workbenchIcon = page.getByTestId("left-layout-rail").getByTestId("open-shortcuts");
	await page.getByTestId("tool-rail-projects").focus();
	await page.keyboard.press("End");
	await expect(workbenchIcon).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(dialog(page)).toBeVisible();
});

test("opened from a Files tree row, the sidebar-trees section comes first", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");
	const row = page.getByRole("tree", { name: "Files" }).getByRole("treeitem").first();
	await row.focus();
	await pressShortcutsChord(page);
	await expect(dialog(page)).toBeVisible();
	await expect(firstSection(page)).toHaveAttribute("data-surface", "trees");
	await expect(firstSection(page)).toContainText("Rename");
	await page.keyboard.press("Escape");
	await expect(row).toBeFocused();
});

test("the filter narrows rows by name or by key, and its paging keys scroll the list", async ({
	page,
}) => {
	await openFixtureProject(page);
	await pressShortcutsChord(page);
	const rows = dialog(page).getByTestId("shortcuts-row");
	const filter = page.getByTestId("shortcuts-filter");
	const list = dialog(page).getByTestId("shortcuts-list");

	await page.keyboard.press("PageDown");
	await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await expect(filter).toBeFocused();

	await filter.fill("split");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toHaveAttribute("data-shortcut", "group.splitRight");
	await expect(rows.first()).toContainText("Split right");
	await expect(rows.first().locator("kbd")).toHaveText(["Ctrl", "\\"]);

	await filter.fill("ctrl+shift+c");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toHaveAttribute("data-shortcut", "terminal.copy");

	await filter.fill("no such shortcut");
	await expect(rows).toHaveCount(0);
	await expect(dialog(page)).toContainText("No shortcuts match.");
});

test("a pane's Hide button shows its chord in the tooltip", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("side-group-fold").hover();
	await expect(page.getByRole("tooltip")).toHaveText(/Hide pane\s*Ctrl\s*B/);
});

test("Settings → Keyboard lists every shortcut with its own filter", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-keyboard").click();
	const section = page.getByTestId("settings-keyboard");
	await expect(page.getByTestId("settings-double-shift")).toBeVisible();
	const rows = section.getByTestId("shortcuts-row");
	await expect(rows.first()).toBeVisible();
	expect(await rows.count()).toBeGreaterThan(40);
	await section.getByTestId("shortcuts-filter").fill("find in files");
	await expect(section.locator('[data-shortcut="files.findInFiles"]')).toContainText(
		"Find in files",
	);
	await expect(section.getByTestId("shortcuts-section").first()).toHaveAttribute(
		"data-surface",
		"general",
	);
});

test("the palette's Keyboard shortcuts command opens the cheatsheet", async ({ page }) => {
	await openFixtureProject(page);
	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("search-palette")).toBeVisible();
	await page.getByTestId("search-input").fill(">keyboard shortcuts");
	const row = page.locator('[data-testid="search-row"][data-item-id="command:shortcuts.open"]');
	await expect(row).toContainText("Ctrl");
	await row.click();
	await expect(page.getByTestId("search-palette")).toHaveCount(0);
	await expect(dialog(page)).toBeVisible();
});
