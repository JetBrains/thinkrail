import { expect, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	openFixtureProject,
	openSettingsSection,
	pressPlatformShortcut,
	revealWorkbenchTool,
} from "./fixtures/app";

const dialog = (page: Page) => page.getByTestId("shortcuts-dialog");
const firstSection = (page: Page) => dialog(page).getByTestId("shortcuts-section").first();
const currentSection = (page: Page) =>
	dialog(page).locator('[data-testid="shortcuts-section"][data-current="true"]');

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
	await expect(firstSection(page)).toHaveAttribute("data-surface", "general");
	await expect(currentSection(page)).toHaveAttribute("data-surface", "trees");
	await expect(currentSection(page)).toContainText("you are here");

	await pressShortcutsChord(page);
	await expect(dialog(page)).toHaveCount(0);
	await expect(project).toBeFocused();

	await pressShortcutsChord(page);
	await expect(dialog(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog(page)).toHaveCount(0);
	await expect(project).toBeFocused();
});

test("the left rail's keyboard icon opens it with General first, nothing highlighted, and shows its chord", async ({
	page,
}) => {
	await openFixtureProject(page);
	const icon = page.getByTestId("left-layout-rail").getByTestId("open-shortcuts");
	await icon.hover();
	await expect(page.getByRole("tooltip")).toHaveText(/Keyboard shortcuts\s*Ctrl\s*\?/);
	await icon.click();
	await expect(dialog(page)).toBeVisible();
	await expect(firstSection(page)).toHaveAttribute("data-surface", "general");
	await expect(currentSection(page)).toHaveCount(0);
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

test("opened from a Files tree row, the sidebar-trees section is highlighted and in view, in catalog order", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");
	const row = page.getByRole("tree", { name: "Files" }).getByRole("treeitem").first();
	await row.focus();
	await pressShortcutsChord(page);
	await expect(dialog(page)).toBeVisible();
	await expect(firstSection(page)).toHaveAttribute("data-surface", "general");
	await expect(currentSection(page)).toHaveAttribute("data-surface", "trees");
	await expect(currentSection(page)).toContainText("Rename");
	await expect(currentSection(page)).toBeInViewport();
	await expect(page.getByTestId("shortcuts-filter")).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(row).toBeFocused();
});

test("the filter narrows rows by name or by key, counts them, and its paging keys scroll the list", async ({
	page,
}) => {
	await openFixtureProject(page);
	await pressShortcutsChord(page);
	const rows = dialog(page).getByTestId("shortcuts-row");
	const filter = page.getByTestId("shortcuts-filter");
	const list = dialog(page).getByTestId("shortcuts-list");
	const count = dialog(page).getByTestId("shortcuts-count");
	await expect(rows.first()).toBeVisible();
	const total = await rows.count();
	expect(total).toBeGreaterThan(40);
	await expect(count).toHaveText(`${total} shortcuts`);

	await page.keyboard.press("PageDown");
	await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	await expect(filter).toBeFocused();

	await filter.fill("split right");
	await expect(rows).toHaveCount(1);
	await expect(count).toHaveText(`1 of ${total}`);
	await expect(rows.first()).toHaveAttribute("data-shortcut", "group.splitRight");
	await expect(rows.first()).toContainText("Split right");
	await expect(rows.first().locator("kbd")).toHaveText(["Ctrl", "\\"]);

	await filter.fill("ctrl+shift+c");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toHaveAttribute("data-shortcut", "terminal.copy");

	await filter.fill("no such shortcut");
	await expect(rows).toHaveCount(0);
	await expect(count).toHaveText(`0 of ${total}`);
	await expect(dialog(page)).toContainText("No shortcuts match.");

	await filter.fill("");
	await expect(count).toHaveText(`${total} shortcuts`);
});

test("at 1600×900 the cheatsheet nearly fills the window in four columns that scroll only down", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await openFixtureProject(page);
	await pressShortcutsChord(page);
	await expect(dialog(page).getByTestId("shortcuts-row").first()).toBeVisible();
	expect(await dialog(page).boundingBox()).toEqual({ x: 24, y: 24, width: 1552, height: 852 });

	const layout = await dialog(page)
		.getByTestId("shortcuts-list")
		.evaluate((list) => {
			const sections = [...list.querySelectorAll('[data-testid="shortcuts-section"]')].map(
				(section) => section.getBoundingClientRect(),
			);
			const misplaced = [...list.querySelectorAll('[data-testid="shortcuts-row"]')].flatMap(
				(row) => {
					const box = row.getBoundingClientRect();
					const title = row.firstElementChild?.getBoundingClientRect();
					const keys = [...row.querySelectorAll("kbd")].map((kbd) => kbd.getBoundingClientRect());
					const spills = keys.some(
						(key) => key.right > box.right + 0.5 || (title !== undefined && key.left < title.right),
					);
					return spills ? [row.getAttribute("data-shortcut")] : [];
				},
			);
			const widths = sections.map((section) => section.width);
			return {
				columns: new Set(sections.map((section) => Math.round(section.left))).size,
				splitSections: Math.max(...widths) - Math.min(...widths),
				sidewaysOverflow: list.scrollWidth - list.clientWidth,
				downwardOverflow: list.scrollHeight - list.clientHeight,
				misplaced,
			};
		});
	expect(layout.columns).toBe(4);
	expect(layout.splitSections).toBeLessThan(1);
	expect(layout.sidewaysOverflow).toBeLessThanOrEqual(0);
	expect(layout.misplaced).toEqual([]);
});

test("a pane's Hide button shows its chord in the tooltip", async ({ page }) => {
	await openFixtureProject(page);
	await page.getByTestId("side-group-fold").hover();
	await expect(page.getByRole("tooltip")).toHaveText(/Hide pane\s*Ctrl\s*B/);
});

test("Settings → Keyboard lists every shortcut by area with its own filter", async ({ page }) => {
	await openFixtureProject(page);
	await openSettingsSection(page, "keyboard");
	const section = page.getByTestId("settings-keyboard");
	await expect(page.getByTestId("settings-double-shift")).toBeVisible();
	const areas = section.getByTestId("keybinding-group");
	await expect(areas.first()).toBeVisible();
	expect(await areas.count()).toBeGreaterThan(8);
	await expect(section.getByTestId("keybinding-row")).toHaveCount(0);
	const total = (await section.getByTestId("keybinding-count").textContent()) ?? "";
	expect(Number(/^(\d+) shortcuts$/.exec(total)?.[1])).toBeGreaterThan(40);
	await section.getByTestId("keybinding-filter").fill("find in files");
	await expect(section.locator('[data-command="files.findInFiles"]')).toContainText(
		"Find in files",
	);
	await expect(section.getByTestId("keybinding-section").first()).toHaveAttribute(
		"data-section",
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
