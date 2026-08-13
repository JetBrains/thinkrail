import { expect, test } from "@playwright/test";
import {
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	visibleTerminal,
	waitTerminalReady,
} from "./fixtures/app";

type Page = import("@playwright/test").Page;

async function width(page: Page, testId: string): Promise<number> {
	const box = await page.getByTestId(testId).boundingBox();
	if (!box) throw new Error(`no bounding box for ${testId}`);
	return box.width;
}

async function dragDividerTo(page: Page, testId: string, targetX: number): Promise<void> {
	const handle = page.getByTestId(testId);
	const box = await handle.boundingBox();
	if (!box) throw new Error(`no bounding box for ${testId}`);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(targetX, box.y + box.height / 2, { steps: 12 });
	await page.mouse.up();
}

async function containsFocus(locator: import("@playwright/test").Locator): Promise<boolean> {
	return locator.evaluate((element) => element.contains(document.activeElement));
}

test("panel header rows align without making the chat toolbar scrollable", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("start-chat").click();
	await expect(page.getByTestId("center-tab-strip")).toBeVisible();
	const openTabs = page.getByTestId("center-tab-strip").locator(":scope > div").first();
	await expect(openTabs).toHaveCSS("overflow-x", "auto");
	await expect(openTabs).toHaveCSS("overflow-y", "hidden");

	const center = await page.getByTestId("center-tab-strip").boundingBox();
	const right = await page.getByTestId("right-tab-strip").boundingBox();
	if (!center || !right) throw new Error("tab strip has no bounding box");

	expect(center.y).toBe(right.y);
	expect(center.height).toBe(28);
	expect(right.height).toBe(center.height);

	await page.getByTestId("tab-changes").click();
	const chat = page.getByTestId("chat-toolbar");
	const changes = page.getByTestId("changes-view-toggle");
	await expect(chat).toHaveCSS("overflow-x", "clip");
	await expect(chat).toHaveCSS("overflow-y", "clip");
	await expect(page.getByTestId("open-skills")).toBeVisible();

	const chatBox = await chat.boundingBox();
	const changesBox = await changes.boundingBox();
	if (!chatBox || !changesBox) throw new Error("panel toolbar has no bounding box");

	expect(chatBox.y).toBe(changesBox.y);
	expect(chatBox.height).toBe(28);
	expect(changesBox.height).toBe(chatBox.height);
});

test("the left|center divider is draggable and resizes the panels", async ({ page }) => {
	await openFixtureProject(page);

	const before = await width(page, "left-nav");
	const handle = page.getByTestId("resize-left");
	const box = await handle.boundingBox();
	if (!box) throw new Error("no handle box");

	// Drag the divider 150px to the right → the left panel grows.
	await dragDividerTo(page, "resize-left", box.x + box.width / 2 + 150);

	const after = await width(page, "left-nav");
	expect(after).toBeGreaterThan(before + 80);
});

test("dragging Projects through its minimum snaps to a persistent reopen rail", async ({
	page,
}) => {
	await openFixtureProject(page);
	const expandedWidth = await width(page, "left-nav");

	await dragDividerTo(page, "resize-left", 1);
	const rail = page.getByTestId("collapsed-left-rail");
	await expect(rail).toBeVisible();
	await expect(rail).toHaveAccessibleName(/Open Projects \(Ctrl\+B\)/);
	expect(await width(page, "collapsed-left-rail")).toBeCloseTo(28, 0);
	await expect(page.getByTestId("left-nav")).toHaveAttribute("aria-hidden", "true");
	await expect(page.getByTestId("resize-left")).toBeHidden();

	await rail.click();
	await expect(rail).toHaveCount(0);
	await expect(page.getByTestId("left-nav")).toBeVisible();
	const restoredWidth = await width(page, "left-nav");
	expect(Math.abs(restoredWidth - expandedWidth)).toBeLessThan(12);
	expect(await containsFocus(page.getByTestId("left-nav"))).toBe(true);

	// The Welcome layout's local shell persistence restores both collapse and pre-drag width.
	await dragDividerTo(page, "resize-left", 1);
	await expect(rail).toBeVisible();
	await page.waitForTimeout(250); // react-resizable-panels debounces its localStorage write
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(rail).toBeVisible();
	await rail.click();
	await expect(page.getByTestId("left-nav")).toBeVisible();
	expect(Math.abs((await width(page, "left-nav")) - expandedWidth)).toBeLessThan(12);
});

test("dragging Workspace closed keeps its terminal stack mounted and restores its width", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
	const expandedWidth = await width(page, "right-stack");
	const viewport = page.viewportSize();
	if (!viewport) throw new Error("no viewport size");

	await dragDividerTo(page, "resize-right", viewport.width - 1);
	const rail = page.getByTestId("collapsed-right-rail");
	await expect(rail).toBeVisible();
	await expect(rail).toHaveAccessibleName(/Open Workspace \(Ctrl\+J\)/);
	await expect(page.getByTestId("right-stack")).toHaveAttribute("aria-hidden", "true");
	await expect(page.getByTestId("resize-right")).toBeHidden();
	// Collapsing the outer region must not tear down its nested files/terminal surfaces.
	await expect(page.getByTestId("right-panel")).toHaveCount(1);
	await expect(page.getByTestId("terminal-instance")).toHaveCount(1);

	await rail.click();
	await expect(rail).toHaveCount(0);
	expect(Math.abs((await width(page, "right-stack")) - expandedWidth)).toBeLessThan(12);
	expect(await containsFocus(page.getByTestId("right-stack"))).toBe(true);
});

test("Mod+B and Mod+J focus first, then collapse, and restore both rails after reload", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	// Let the newly-mounted terminal take its one intentional initial focus before we establish the center
	// target whose focus the panel commands must remember.
	await waitTerminalReady(page);
	const centerTarget = page.getByTestId("start-chat");
	await centerTarget.focus();

	// Visible + focus elsewhere → focus Projects only. A second press while inside → collapse.
	await page.keyboard.press("Control+b");
	expect(await containsFocus(page.getByTestId("left-nav"))).toBe(true);
	await expect(page.getByTestId("collapsed-left-rail")).toHaveCount(0);
	await page.keyboard.press("Control+b");
	await expect(page.getByTestId("collapsed-left-rail")).toBeVisible();
	await expect(centerTarget).toBeFocused();

	// Collapsed → expand and restore focus inside.
	await page.keyboard.press("Control+b");
	await expect(page.getByTestId("collapsed-left-rail")).toHaveCount(0);
	expect(await containsFocus(page.getByTestId("left-nav"))).toBe(true);

	await centerTarget.focus();
	await page.keyboard.press("Control+j");
	expect(await containsFocus(page.getByTestId("right-stack"))).toBe(true);
	await expect(page.getByTestId("collapsed-right-rail")).toHaveCount(0);
	await page.keyboard.press("Control+j");
	await expect(page.getByTestId("collapsed-right-rail")).toBeVisible();
	await expect(centerTarget).toBeFocused();
	await page.keyboard.press("Control+j");
	await expect(page.getByTestId("collapsed-right-rail")).toHaveCount(0);
	expect(await containsFocus(page.getByTestId("right-stack"))).toBe(true);

	// Layout commands intentionally win inside xterm; Ctrl+J collapses rather than sending line-feed.
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await page.keyboard.press("Control+j");
	await expect(page.getByTestId("collapsed-right-rail")).toBeVisible();
	await expect(centerTarget).toBeFocused();

	// Collapse Projects too, proving the two fixed rails can coexist around a still-usable center.
	await page.keyboard.press("Control+b");
	await page.keyboard.press("Control+b");
	await expect(page.getByTestId("collapsed-left-rail")).toBeVisible();
	await expect(page.getByTestId("collapsed-right-rail")).toBeVisible();
	expect(await width(page, "collapsed-left-rail")).toBeCloseTo(28, 0);
	expect(await width(page, "collapsed-right-rail")).toBeCloseTo(28, 0);

	await page.waitForTimeout(250);
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	// Reload starts on Project Home, whose separately-saved left layout remains open. Re-entering the
	// workspace mounts its own saved group and restores both collapsed outer regions.
	await page.getByTestId("project-expand").first().click();
	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await expect(page.getByTestId("workspace-shell-layout")).toHaveAttribute(
		"data-left-collapsed",
		"true",
	);
	await expect(page.getByTestId("workspace-shell-layout")).toHaveAttribute(
		"data-right-collapsed",
		"true",
	);
	await expect(page.getByTestId("collapsed-left-rail")).toBeVisible();
	await expect(page.getByTestId("collapsed-right-rail")).toBeVisible();
});
