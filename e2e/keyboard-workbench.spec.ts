import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
	waitTerminalReady,
} from "./fixtures/app";

test.use({ viewport: { width: 1440, height: 900 } });

async function openWorkbenchWithFiles(page: Page, names: readonly string[]): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
	await revealWorkbenchTool(page, "files");
	for (const name of names) {
		await page.getByTestId("file-node").filter({ hasText: name }).dblclick();
	}
	await expect(page.getByTestId("editor-tab")).toHaveCount(names.length);
	await expect(centerGroups(page)).toHaveCount(1);
}

function centerGroups(page: Page): Locator {
	return page.getByTestId("center-group");
}

function fileTab(scope: Page | Locator, name: string): Locator {
	return scope.getByRole("tab", { name: new RegExp(name.replace(".", "\\.")) });
}

async function pressMoveTab(page: Page, key: "ArrowLeft" | "ArrowRight"): Promise<void> {
	const apple = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? ""));
	await page.keyboard.press(`${apple ? "Control+Meta" : "Control+Alt"}+${key}`);
}

test("Mod+\\ splits the active tab right and the move chords walk it between groups, stopping at the edges", async ({
	page,
}) => {
	await openWorkbenchWithFiles(page, ["README.md", "notes.txt"]);
	const groups = centerGroups(page);
	await fileTab(page, "notes.txt").click();

	await pressPlatformShortcut(page, "Backslash");
	await expect(groups).toHaveCount(2);
	await expect(page.getByTestId("center-split-resize")).toHaveCount(1);
	await expect(fileTab(groups.nth(0), "README.md")).toBeVisible();
	await expect(fileTab(groups.nth(1), "notes.txt")).toBeFocused();

	await pressMoveTab(page, "ArrowLeft");
	await expect(fileTab(groups.nth(0), "notes.txt")).toBeFocused();
	await expect(groups.nth(1).getByRole("tab")).toHaveCount(0);

	await pressMoveTab(page, "ArrowLeft");
	await expect(groups).toHaveCount(2);
	await expect(fileTab(groups.nth(0), "notes.txt")).toBeFocused();
	await expect(groups.nth(1).getByRole("tab")).toHaveCount(0);

	await pressMoveTab(page, "ArrowRight");
	await expect(fileTab(groups.nth(1), "notes.txt")).toBeFocused();
	await pressMoveTab(page, "ArrowRight");
	await expect(groups).toHaveCount(2);
	await expect(fileTab(groups.nth(1), "notes.txt")).toBeFocused();
	await expect(fileTab(groups.nth(0), "README.md")).toBeVisible();
});

test("Mod+Alt+W first dismisses an open layer, then closes the active tab and focus moves beside it", async ({
	page,
}) => {
	await openWorkbenchWithFiles(page, ["README.md", "notes.txt"]);
	await fileTab(page, "notes.txt").click();

	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("search-palette")).toBeVisible();
	await pressPlatformShortcut(page, "Alt+KeyW");
	await expect(page.getByTestId("search-palette")).toHaveCount(0);
	await expect(page.getByTestId("editor-tab")).toHaveCount(2);

	await pressPlatformShortcut(page, "Alt+KeyW");
	await expect(page.getByTestId("editor-tab")).toHaveCount(1);
	await expect(fileTab(page, "README.md")).toBeFocused();
});

test("a palette command runs on the tab that was active before the palette opened, with its chord shown", async ({
	page,
}) => {
	await openWorkbenchWithFiles(page, ["README.md", "notes.txt"]);
	await fileTab(page, "README.md").click();
	await expect(fileTab(page, "README.md")).toHaveAttribute("aria-selected", "true");

	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("search-palette")).toBeVisible();
	await page.getByTestId("search-input").fill(">split");
	const splitRight = page.locator(
		'[data-testid="search-row"][data-item-id="command:group.splitRight"]',
	);
	await expect(splitRight).toContainText("Active tab");
	await expect(splitRight.locator("kbd").last()).toHaveText("\\");
	await page.getByTestId("search-input").fill(">split down");
	await expect(
		page.locator('[data-testid="search-row"][data-item-id="command:group.splitDown"]'),
	).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("search-palette")).toBeHidden();

	const groups = centerGroups(page);
	await expect(groups).toHaveCount(2);
	await expect(fileTab(groups.nth(0), "notes.txt")).toBeVisible();
	await expect(fileTab(groups.nth(1), "README.md")).toBeFocused();
	const [top, bottom] = await Promise.all([
		groups.nth(0).boundingBox(),
		groups.nth(1).boundingBox(),
	]);
	expect(bottom?.y ?? 0).toBeGreaterThan(top?.y ?? 0);
});

test("Shift+F10 and the Menu key open the tab and rail menus, and Escape returns focus", async ({
	page,
}) => {
	await openWorkbenchWithFiles(page, ["README.md"]);
	const readme = fileTab(page, "README.md");
	await readme.focus();
	await page.keyboard.press("Shift+F10");
	await expect(page.getByRole("menuitem", { name: "Split right", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu")).toHaveCount(0);
	await expect(readme).toBeFocused();

	const filesEntry = page.getByTestId("tool-rail-files");
	await filesEntry.focus();
	await page.keyboard.press("ContextMenu");
	await expect(
		page.getByRole("menuitem", { name: "Remove tool from group", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("menu")).toHaveCount(0);
	await expect(filesEntry).toBeFocused();
});

test("Ctrl+\\ inside a terminal stays with the shell", async ({ page }) => {
	await openWorkbenchWithFiles(page, []);
	const groups = centerGroups(page);
	await groups.getByTestId("new-terminal").click();
	const centerTerminal = groups.getByRole("tab", { name: /Terminal/ });
	await expect(centerTerminal).toHaveCount(1);
	await expect(groups.locator('[data-testid="terminal-instance"]')).toHaveAttribute(
		"data-ready",
		"true",
	);
	await groups.locator(".xterm-helper-textarea").focus();

	await page.keyboard.press("Control+Backslash");
	await expect(groups).toHaveCount(1);
	await expect(groups.locator(".xterm-helper-textarea")).toBeFocused();

	await centerTerminal.focus();
	await pressPlatformShortcut(page, "Backslash");
	await expect(groups).toHaveCount(2);
});
