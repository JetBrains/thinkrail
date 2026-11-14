import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	enterDefaultWorkspace,
	goProjectHome,
	openFixtureProject,
	pressPlatformShortcut,
	revealWorkbenchTool,
	visibleTerminal,
	waitTerminalReady,
} from "./fixtures/app";

test.use({ viewport: { width: 1440, height: 900 } });

async function openChatWorkbench(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
	await page.getByTestId("start-chat").first().click();
	await expect(page.getByTestId("chat-input")).toBeVisible();
	await page.getByTestId("chat-input").focus();
}

function activeRegion(page: Page): Locator {
	return page.locator("[data-region-active]");
}

function terminalInput(page: Page): Locator {
	return visibleTerminal(page).locator(".xterm-helper-textarea");
}

function focusedRegionKind(page: Page): Promise<string | null> {
	return page.evaluate(
		() =>
			document.activeElement?.closest("[data-region]")?.getAttribute("data-region-kind") ?? null,
	);
}

async function expectFocusInside(container: Locator): Promise<void> {
	await expect
		.poll(() => container.evaluate((element) => element.contains(document.activeElement)))
		.toBe(true);
}

function veil(region: Locator): Promise<string> {
	return region.evaluate((element) => getComputedStyle(element, "::after").content);
}

test("F6 walks the region ring and Shift+F6 walks it back, muting every region but the active one", async ({
	page,
}) => {
	await openChatWorkbench(page);
	await expect(activeRegion(page)).toHaveAttribute("data-region-kind", "center");
	await expect(page.locator("html")).toHaveAttribute("data-region-tracking", "");

	const forward = ["right", "right", "bottom", "topbar", "left", "center"];
	for (const kind of forward) {
		await page.keyboard.press("F6");
		await expect(activeRegion(page)).toHaveAttribute("data-region-kind", kind);
		await expect(activeRegion(page)).toHaveCount(1);
		expect(await focusedRegionKind(page)).toBe(kind);
	}
	await expect(page.getByTestId("chat-input")).toBeFocused();

	for (const kind of ["left", "topbar", "bottom", "right", "right", "center"]) {
		await page.keyboard.press("Shift+F6");
		await expect(activeRegion(page)).toHaveAttribute("data-region-kind", kind);
	}
	await expect(page.getByTestId("chat-input")).toBeFocused();

	const topbar = page.locator('[data-region-kind="topbar"]');
	const center = page.locator('[data-region-kind="center"]');
	expect(await veil(topbar)).toBe('""');
	expect(await veil(center)).toBe("none");
	await page.keyboard.press("Shift+F6");
	await page.keyboard.press("Shift+F6");
	await expect(topbar).toHaveAttribute("data-region-active", "");
	await expect(center).not.toHaveAttribute("data-region-active");
	expect(await veil(topbar)).toBe("none");
	expect(await veil(center)).toBe('""');
	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("search-palette")).toBeVisible();
	await expect(topbar).toHaveAttribute("data-region-active", "");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("search-palette")).toBeHidden();
	await expect(activeRegion(page)).toHaveCount(1);
});

test("with no active region F6 starts at the top bar and Shift+F6 at the last region", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
	await expect(page.locator("html")).not.toHaveAttribute("data-region-tracking");
	await expect(activeRegion(page)).toHaveCount(0);
	await page.keyboard.press("F6");
	await expect(activeRegion(page)).toHaveAttribute("data-region-kind", "topbar");

	await page.reload();
	await waitTerminalReady(page);
	await expect(activeRegion(page)).toHaveCount(0);
	await page.keyboard.press("Shift+F6");
	await expect(activeRegion(page)).toHaveAttribute("data-region-kind", "bottom");
	await expect(terminalInput(page)).toBeFocused();
});

test("F6 leaves a focused terminal, Ctrl+L stays the shell's there, and Ctrl+` goes into the terminal and back", async ({
	page,
}) => {
	await openChatWorkbench(page);
	await terminalInput(page).focus();
	await expect(activeRegion(page)).toHaveAttribute("data-region-kind", "bottom");
	await page.keyboard.press("F6");
	await expect(activeRegion(page)).toHaveAttribute("data-region-kind", "topbar");
	await page.keyboard.press("Shift+F6");
	await expect(terminalInput(page)).toBeFocused();
	await page.keyboard.press("Control+l");
	await expect(terminalInput(page)).toBeFocused();
	await page.keyboard.press("F6");
	await pressPlatformShortcut(page, "l");
	await expect(page.getByTestId("chat-input")).toBeFocused();

	await page.keyboard.press("Control+Backquote");
	await expect(terminalInput(page)).toBeFocused();
	await page.keyboard.press("Control+Backquote");
	await expect(page.getByTestId("chat-input")).toBeFocused();

	await pressPlatformShortcut(page, "Shift+J");
	await expect(page.getByTestId("bottom-panel")).toHaveCount(0);
	await page.keyboard.press("Control+Backquote");
	await expect(page.getByTestId("bottom-panel")).toBeVisible();
	await expect(terminalInput(page)).toBeFocused();
});

test("Mod+0 focuses Projects, and Mod+Shift+E / Mod+Shift+G open Files in All / Changed with focus inside", async ({
	page,
}) => {
	await openChatWorkbench(page);
	await pressPlatformShortcut(page, "0");
	await expectFocusInside(page.locator('[data-tool-body="projects"]'));
	await expect(activeRegion(page)).toHaveAttribute("data-region-kind", "left");

	const files = page.locator('[data-tool-body="files"]');
	await revealWorkbenchTool(page, "specs");
	await pressPlatformShortcut(page, "Shift+E");
	await expect(page.getByTestId("files-mode-all")).toHaveAttribute("aria-pressed", "true");
	await expectFocusInside(files);
	await pressPlatformShortcut(page, "Shift+G");
	await expect(page.getByTestId("files-mode-changed")).toHaveAttribute("aria-pressed", "true");
	await expectFocusInside(files);

	await pressPlatformShortcut(page, "Shift+E");
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).focus();
	await pressPlatformShortcut(page, "l");
	await expect(page.getByTestId("chat-input")).toBeFocused();
	await pressPlatformShortcut(page, "Shift+G");
	await expectFocusInside(files.locator('[data-files-mode="changed"]'));

	await goProjectHome(page);
	const home = page.locator('[data-region-kind="home"]');
	await page.getByTestId("open-search").focus();
	await pressPlatformShortcut(page, "0");
	await expectFocusInside(home);
	await pressPlatformShortcut(page, "b");
	await expect(home).toHaveAttribute("inert", "");
	await pressPlatformShortcut(page, "0");
	await expect(home).not.toHaveAttribute("inert");
	await expectFocusInside(home);
});

test("Mod+1 and Mod+2 focus center groups in visual order, and Mod+L returns to the chat, closing its history", async ({
	page,
}) => {
	await openChatWorkbench(page);
	await revealWorkbenchTool(page, "files");
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	const readme = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	await readme.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Split right" }).click();
	const groups = page.getByTestId("center-group");
	await expect(groups).toHaveCount(2);

	await pressPlatformShortcut(page, "1");
	await expect(page.getByTestId("chat-input")).toBeFocused();
	await pressPlatformShortcut(page, "2");
	await expectFocusInside(groups.nth(1));
	await expect(groups.nth(1)).toHaveAttribute("data-region-active", "");
	await pressPlatformShortcut(page, "3");
	await expectFocusInside(groups.nth(1));
	await pressPlatformShortcut(page, "l");
	await expect(page.getByTestId("chat-input")).toBeFocused();
	await expect(groups.nth(0)).toHaveAttribute("data-region-active", "");

	await page.keyboard.press("Control+r");
	await expect(page.getByTestId("history-overlay")).toBeVisible();
	await pressPlatformShortcut(page, "l");
	await expect(page.getByTestId("history-overlay")).toHaveCount(0);
	await expect(page.getByTestId("chat-input")).toBeFocused();
});

test("the palette lists the focus commands with their chords and runs them after it closes", async ({
	page,
}) => {
	await openChatWorkbench(page);
	await pressPlatformShortcut(page, "k");
	const palette = page.getByTestId("search-palette");
	await expect(palette).toBeVisible();
	const row = (id: string) =>
		palette.locator(`[data-testid="search-row"][data-item-id="command:${id}"]`);

	await page.getByTestId("search-input").fill(">focus");
	for (const [id, key] of [
		["region.next", "F6"],
		["region.previous", "F6"],
		["focus.composer", "L"],
		["focus.projects", "0"],
		["focus.terminal", "`"],
		["focus.group1", "1"],
	] as const) {
		await expect(row(id)).toBeVisible();
		await expect(row(id).locator("kbd").last()).toHaveText(key);
	}
	await expect(row("focus.group2")).toHaveCount(0);

	await page.getByTestId("search-input").fill(">show");
	await expect(row("view.show.files").locator("kbd").last()).toHaveText("E");
	await expect(row("view.changes").locator("kbd").last()).toHaveText("G");

	await page.getByTestId("search-input").fill(">focus terminal");
	await expect(row("focus.terminal")).toBeVisible();
	await row("focus.terminal").click();
	await expect(palette).toBeHidden();
	await expect(terminalInput(page)).toBeFocused();
});

test("the Appearance switch drops the veil over the regions without the keyboard focus", async ({
	page,
}) => {
	await openChatWorkbench(page);
	const topbar = page.locator('[data-region-kind="topbar"]');
	const center = page.locator('[data-region-kind="center"]');
	const composer = page.getByTestId("chat-input");
	expect(await veil(topbar)).toBe('""');

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	const toggle = page.getByTestId("dim-inactive-panels-toggle");
	await expect(toggle).toHaveAttribute("data-active", "true");

	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "false");
	await expect(page.locator("html")).toHaveAttribute("data-region-dim", "off");
	await page.keyboard.press("Escape");
	await composer.focus();
	await expect(center).toHaveAttribute("data-region-active", "");
	expect(await veil(topbar)).toBe("none");

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-appearance").click();
	await toggle.click();
	await expect(toggle).toHaveAttribute("data-active", "true");
	await expect(page.locator("html")).not.toHaveAttribute("data-region-dim");
	await page.keyboard.press("Escape");
	await composer.focus();
	await expect(center).toHaveAttribute("data-region-active", "");
	expect(await veil(topbar)).toBe('""');
});
