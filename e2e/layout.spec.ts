import { expect, type Locator, type Page, test, type WebSocketRoute } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	openFixtureProject,
	pressPlatformShortcut,
	revealFirstProjectWorkspaces,
	waitTerminalReady,
} from "./fixtures/app";

async function openDefaultWorkbench(page: Page): Promise<void> {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await waitTerminalReady(page);
}

async function waitForLayoutSettled(page: Page): Promise<void> {
	await expect(page.getByTestId("workspace-workbench")).toHaveAttribute(
		"data-layout-status",
		"settled",
	);
}

async function openKeptFiles(page: Page, names: string[]): Promise<void> {
	await page.getByTestId("tab-files").click();
	for (const name of names) {
		await page.getByTestId("file-node").filter({ hasText: name }).dblclick();
	}
	await expect(page.getByTestId("editor-tab")).toHaveCount(names.length);
}

async function width(locator: Locator): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error("element has no bounding box");
	return box.width;
}

async function height(locator: Locator): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error("element has no bounding box");
	return box.height;
}

async function dragHandle(page: Page, handle: Locator, x: number, y: number): Promise<void> {
	const box = await handle.boundingBox();
	if (!box) throw new Error("resize handle has no bounding box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(x, y, { steps: 12 });
	await page.mouse.up();
}

async function dragSideClosed(page: Page, side: "left" | "right"): Promise<void> {
	const workbenchBox = await page.getByTestId("workbench").boundingBox();
	if (!workbenchBox) throw new Error("workbench has no bounding box");
	const targetX = side === "left" ? workbenchBox.x + 1 : workbenchBox.x + workbenchBox.width - 1;
	await dragHandle(
		page,
		page.getByTestId(`resize-${side}`),
		targetX,
		workbenchBox.y + workbenchBox.height / 2,
	);
}

async function dragTabToTarget(page: Page, tab: Locator, target: Locator): Promise<number> {
	const tabBox = await tab.boundingBox();
	if (!tabBox) throw new Error("dragged tab has no bounding box");
	await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(tabBox.x + tabBox.width / 2 + 12, tabBox.y + tabBox.height / 2 + 8, {
		steps: 4,
	});
	await expect(target).toBeVisible();
	const targetBox = await target.boundingBox();
	if (!targetBox) throw new Error("drop target has no bounding box");
	await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
		steps: 8,
	});
	await expect(target).toHaveAttribute("data-drop-active", "true");
	await page.mouse.up();
	return targetBox.height;
}

async function reloadDefaultWorkbench(page: Page): Promise<void> {
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("center-tabs")).toBeVisible();
}

function sideGroups(page: Page, side: "left" | "right"): Locator {
	return page.locator(`[data-side="${side}"][data-group-id]`);
}

async function collapseToOneCenterGroup(page: Page): Promise<void> {
	const remove = page.locator(
		'[data-testid="center-group"] [data-testid="remove-layout-group"]:not([disabled])',
	);
	if ((await remove.count()) > 0) await remove.last().click();
	await expect(page.getByTestId("center-group")).toHaveCount(1);
}

test("workbench strips and feature toolbars keep one-row geometry with ARIA tabs", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await page.getByTestId("start-chat").first().click();

	const centerStrip = page.getByTestId("center-tab-strip").first();
	const rightStrip = page.getByTestId("right-tab-strip");
	const bottomStrip = page.getByTestId("bottom-tab-strip");
	for (const strip of [centerStrip, rightStrip, bottomStrip]) {
		await expect(strip).toHaveCSS("height", "32px");
		await expect(strip.getByRole("tablist")).toHaveCount(1);
		await expect(strip.getByRole("button", { name: /^Scroll tabs (left|right)$/ })).toHaveCount(0);
		const active = strip.locator('[role="tab"][aria-selected="true"]');
		await expect(active).toHaveCount(1);
		const panelId = await active.getAttribute("aria-controls");
		const tabId = await active.getAttribute("id");
		if (!panelId || !tabId) throw new Error("active tab is missing its ARIA relationship");
		const panel = page.locator(`[id="${panelId}"]`);
		await expect(panel).toHaveAttribute("role", "tabpanel");
		await expect(panel).toHaveAttribute("aria-labelledby", tabId);
	}
	const centerScroller = centerStrip.getByRole("tablist");
	await expect(centerScroller).toHaveCSS("overflow-x", "auto");
	await expect(centerScroller).toHaveCSS("overflow-y", "hidden");
	for (const tool of ["projects", "specs", "files", "changes", "review"]) {
		await expect(
			page.getByTestId(`tab-${tool}`).getByRole("button", { name: /^Close / }),
		).toHaveCount(0);
	}
	await expect(page.getByTestId("tab-files")).toContainText("Files");
	await expect(page.getByTestId("tab-files")).not.toContainText("All files");
	await expect(centerStrip.getByTestId("editor-tab-close")).toHaveCount(1);
	await expect(bottomStrip.getByTestId("terminal-tab-close")).toHaveCount(1);

	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("chat-toolbar")).toHaveCSS("height", "32px");
	await expect(page.getByTestId("chat-toolbar")).toHaveCSS("overflow-x", "clip");
	await expect(page.getByTestId("changes-view-toggle")).toHaveCSS("height", "32px");
});

test("overflow uses directional fades without changing tab-strip geometry", async ({ page }) => {
	await page.setViewportSize({ width: 800, height: 720 });
	await openDefaultWorkbench(page);
	await collapseToOneCenterGroup(page);
	await openKeptFiles(page, [
		"README.md",
		"notes.txt",
		"ALERTS.md",
		"DIAGRAM.md",
		"LARGE.md",
		"LINKS.md",
	]);
	const strip = page.getByTestId("center-tab-strip").first();
	const tablist = strip.getByRole("tablist");
	await expect
		.poll(() => tablist.evaluate((element) => element.scrollWidth > element.clientWidth))
		.toBe(true);
	await expect(tablist).toHaveCSS("scrollbar-width", "none");
	await expect
		.poll(() =>
			tablist.evaluate((element) => getComputedStyle(element, "::-webkit-scrollbar").display),
		)
		.toBe("none");
	await expect(strip).toHaveCSS("height", "32px");
	await expect.poll(() => height(strip.getByRole("tab").first())).toBeCloseTo(28, 1);

	await tablist.evaluate((element) => {
		element.scrollLeft = 0;
	});
	await expect(strip.getByTestId("tab-overflow-before")).toHaveCount(0);
	await expect(strip.getByTestId("tab-overflow-after")).toHaveCount(1);

	await tablist.evaluate((element) => {
		element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
	});
	await expect(strip.getByTestId("tab-overflow-before")).toHaveCount(1);
	await expect(strip.getByTestId("tab-overflow-after")).toHaveCount(1);

	await strip.getByRole("tab", { name: /README\.md/ }).focus();
	await page.keyboard.press("End");
	const last = strip.getByRole("tab", { name: /LINKS\.md/ });
	await expect(last).toBeFocused();
	await expect(strip.getByTestId("tab-overflow-before")).toHaveCount(1);
	await expect(strip.getByTestId("tab-overflow-after")).toHaveCount(0);
	await expect
		.poll(async () => {
			const [listBox, tabBox] = await Promise.all([tablist.boundingBox(), last.boundingBox()]);
			if (!listBox || !tabBox) return false;
			return tabBox.x >= listBox.x && tabBox.x + tabBox.width <= listBox.x + listBox.width + 1;
		})
		.toBe(true);
	await expect(strip).toHaveCSS("height", "32px");
	await expect.poll(() => height(last)).toBeCloseTo(28, 1);
});

test("ARIA tabs use roving keyboard focus, recover after close, and expose keyboard separators", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await openKeptFiles(page, ["README.md", "notes.txt", "LINKS.md"]);
	const center = page.getByTestId("center-tab-strip");
	const readme = center.getByRole("tab", { name: /README\.md/ });
	const notes = center.getByRole("tab", { name: /notes\.txt/ });
	const links = center.getByRole("tab", { name: /LINKS\.md/ });

	await links.focus();
	await page.keyboard.press("Home");
	await expect(readme).toBeFocused();
	await expect(readme).toHaveAttribute("aria-selected", "true");
	await expect(notes).toHaveAttribute("tabindex", "-1");

	await page.keyboard.press("ArrowRight");
	await expect(notes).toBeFocused();
	await expect(notes).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Delete");
	await expect(links).toBeFocused();
	await expect(links).toHaveAttribute("aria-selected", "true");

	const separator = page.getByTestId("resize-right");
	await expect(separator).toHaveAttribute("role", "separator");
	await expect(separator).toHaveAttribute("aria-orientation", "vertical");
	await expect(separator).toHaveAttribute("aria-valuemin", /\d+/);
	await expect(separator).toHaveAttribute("aria-valuemax", /\d+/);
	await expect(separator).toHaveAttribute("aria-valuenow", /\d+/);
	const before = await width(page.getByTestId("right-stack"));
	await separator.focus();
	await page.keyboard.press("ArrowLeft");
	await expect.poll(() => width(page.getByTestId("right-stack"))).not.toBeCloseTo(before, 0);

	const bottomSeparator = page.getByTestId("resize-bottom");
	await expect(bottomSeparator).toHaveAttribute("role", "separator");
	await expect(bottomSeparator).toHaveAttribute("aria-orientation", "horizontal");
	await expect(bottomSeparator).toHaveAttribute("aria-valuemin", /\d+/);
	await expect(bottomSeparator).toHaveAttribute("aria-valuemax", /\d+/);
	await expect(bottomSeparator).toHaveAttribute("aria-valuenow", /\d+/);
});

test("outer side widths publish on pointer-up and restore after reload", async ({ page }) => {
	await openDefaultWorkbench(page);
	const right = page.getByTestId("right-stack");
	const before = await width(right);
	const handle = page.getByTestId("resize-right");
	const handleBox = await handle.boundingBox();
	if (!handleBox) throw new Error("right resize handle has no box");

	await dragHandle(page, handle, handleBox.x - 120, handleBox.y + handleBox.height / 2);
	await expect.poll(() => width(right)).toBeGreaterThan(before + 70);
	const resized = await width(right);

	await reloadDefaultWorkbench(page);
	await expect.poll(() => width(page.getByTestId("right-stack"))).toBeGreaterThan(before + 50);
	expect(Math.abs((await width(page.getByTestId("right-stack"))) - resized)).toBeLessThan(24);
});

test("one local frame survives workspace switches while resource tabs stay workspace-specific", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	const handle = page.getByTestId("resize-right");
	const handleBox = await handle.boundingBox();
	if (!handleBox) throw new Error("right resize handle has no box");
	await dragHandle(page, handle, handleBox.x - 70, handleBox.y + handleBox.height / 2);
	const resized = await width(page.getByTestId("right-stack"));
	await pressPlatformShortcut(page, "Shift+j");
	await expect(page.getByTestId("bottom-layout-rail")).toBeVisible();

	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toHaveCount(0);
	await expect(page.getByTestId("bottom-layout-rail")).toBeVisible();
	await expect.poll(() => width(page.getByTestId("right-stack"))).toBeCloseTo(resized, 0);

	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toHaveCount(1);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
	await expect(page.getByTestId("bottom-layout-rail")).toBeVisible();
});

test("dragging outer separators hides both sides and preserves their restore state", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	const leftWidth = await width(page.getByTestId("left-stack"));
	const rightWidth = await width(page.getByTestId("right-stack"));

	await dragSideClosed(page, "left");
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();
	await expect(page.getByTestId("left-stack")).toHaveCount(0);

	await dragSideClosed(page, "right");
	await expect(page.getByTestId("right-layout-rail")).toBeVisible();
	await expect(page.getByTestId("right-stack")).toHaveCount(0);
	await waitForLayoutSettled(page);

	await reloadDefaultWorkbench(page);
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();
	await expect(page.getByTestId("right-layout-rail")).toBeVisible();

	await page.getByRole("button", { name: "Show left side" }).click();
	await waitForLayoutSettled(page);
	await page.getByRole("button", { name: "Show right side" }).click();
	await waitForLayoutSettled(page);

	await expect(page.getByTestId("left-stack")).toBeVisible();
	await expect(page.getByTestId("right-stack")).toBeVisible();
	await expect
		.poll(async () => Math.abs((await width(page.getByTestId("left-stack"))) - leftWidth))
		.toBeLessThan(24);
	await expect
		.poll(async () => Math.abs((await width(page.getByTestId("right-stack"))) - rightWidth))
		.toBeLessThan(24);
	await waitTerminalReady(page);
});

test("the side group menu shows tools for its own side and opens terminals in that group", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	const specsGroup = sideGroups(page, "right").first();
	await expect(specsGroup.getByTestId("terminal-tab")).toHaveCount(0);

	await specsGroup.getByRole("button", { name: "Add to this group" }).click();
	await page.getByTestId("side-new-terminal").click();
	await expect(specsGroup.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(page.getByTestId("center-tab-strip").getByTestId("terminal-tab")).toHaveCount(0);

	await page.getByTestId("tab-projects").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Close", exact: true }).click();
	await page.getByTestId("tab-changes").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Close", exact: true }).click();

	await specsGroup.getByRole("button", { name: "Add to this group" }).click();
	await expect(page.getByTestId("show-tool-changes")).toBeVisible();
	await expect(page.getByTestId("show-tool-projects")).toHaveCount(0);
});

test("a terminal can move to its own side group; resize, fold, and visibility gate its one body", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await pressPlatformShortcut(page, "b");
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();
	const terminalTab = page.getByTestId("terminal-tab");
	await terminalTab.scrollIntoViewIfNeeded();
	const terminalBox = await terminalTab.boundingBox();
	if (!terminalBox) throw new Error("terminal tab has no box");
	await page.mouse.move(
		terminalBox.x + terminalBox.width / 2,
		terminalBox.y + terminalBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		terminalBox.x + terminalBox.width / 2 - 12,
		terminalBox.y + terminalBox.height / 2 + 8,
		{ steps: 4 },
	);
	const sideTarget = page.locator('[data-drop-label="Create left group in hidden side"]');
	await expect(sideTarget).toBeVisible();
	const sideTargetBox = await sideTarget.boundingBox();
	if (!sideTargetBox) throw new Error("left side drop target has no box");
	await page.mouse.move(
		sideTargetBox.x + sideTargetBox.width / 2,
		sideTargetBox.y + sideTargetBox.height / 2,
		{ steps: 8 },
	);
	await page.mouse.up();

	await expect(sideGroups(page, "left")).toHaveCount(2);
	await expect(sideGroups(page, "right")).toHaveCount(2);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(page.getByTestId("terminal-instance")).toHaveCount(1);
	await page.getByTestId("terminal-tab").click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: "New left group at bottom", exact: true }),
	).toBeEnabled();
	await expect(page.getByRole("menuitem", { name: "New left group at top" })).toBeEnabled();
	await page.keyboard.press("Escape");

	const projectsGroup = sideGroups(page, "left").filter({ has: page.getByTestId("tab-projects") });
	const before = await height(projectsGroup);
	const verticalHandle = page.getByTestId("left-group-resize");
	const handleBox = await verticalHandle.boundingBox();
	if (!handleBox) throw new Error("left group resize handle has no box");
	await dragHandle(page, verticalHandle, handleBox.x, handleBox.y + 80);
	await expect.poll(() => height(projectsGroup)).toBeGreaterThan(before + 40);

	const terminalGroup = sideGroups(page, "left").filter({ has: page.getByTestId("terminal-tab") });
	await terminalGroup.getByTestId("side-group-fold").click();
	await expect(terminalGroup).toHaveAttribute("data-folded", "true");
	expect(await height(terminalGroup)).toBeCloseTo(27, 0);
	await expect(page.getByTestId("terminal-instance")).toHaveCount(0);

	await terminalGroup.getByTestId("side-group-fold").focus();
	await page.keyboard.press("Space");
	await expect(terminalGroup).toHaveAttribute("data-folded", "false");
	await waitTerminalReady(page);
	await expect(page.getByTestId("terminal-instance")).toHaveCount(1);

	await projectsGroup.getByTestId("side-group-fold").click();
	await terminalGroup.getByTestId("side-group-fold").click();
	await expect(projectsGroup).toHaveAttribute("data-folded", "true");
	await expect(terminalGroup).toHaveAttribute("data-folded", "true");
	expect(await height(projectsGroup)).toBeCloseTo(27, 0);
	expect(await height(terminalGroup)).toBeCloseTo(27, 0);
	await projectsGroup.getByTestId("side-group-fold").click();
	await terminalGroup.getByTestId("side-group-fold").click();
	await waitTerminalReady(page);

	await page.getByTestId("tab-files").click({ button: "right" });
	await page.getByRole("menuitem", { name: "New left group at bottom", exact: true }).click();
	await expect(sideGroups(page, "left")).toHaveCount(3);
	await expect(page.getByTestId("tab-files")).toHaveCount(1);
});

test("side groups expose broad per-panel above and below split targets", async ({ page }) => {
	await openDefaultWorkbench(page);
	const files = page.getByTestId("tab-files");

	await files.click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: "New group above", exact: true })).toBeEnabled();
	await expect(page.getByRole("menuitem", { name: "New group below", exact: true })).toBeEnabled();
	await page.keyboard.press("Escape");

	let changesGroup = sideGroups(page, "right").filter({ has: page.getByTestId("tab-changes") });
	const aboveTarget = changesGroup.locator('[data-drop-label="Create right group above"]');
	const aboveHeight = await dragTabToTarget(page, files, aboveTarget);
	expect(aboveHeight).toBeGreaterThan(40);

	let groups = sideGroups(page, "right");
	await expect(groups).toHaveCount(3);
	await expect(groups.nth(0).getByTestId("tab-specs")).toBeVisible();
	await expect(groups.nth(1).getByTestId("tab-files")).toBeVisible();
	await expect(groups.nth(2).getByTestId("tab-changes")).toBeVisible();

	changesGroup = groups.filter({ has: page.getByTestId("tab-changes") });
	const belowTarget = changesGroup.locator('[data-drop-label="Create right group below"]');
	const belowHeight = await dragTabToTarget(page, page.getByTestId("tab-files"), belowTarget);
	expect(belowHeight).toBeGreaterThan(40);

	groups = sideGroups(page, "right");
	await expect(groups).toHaveCount(4);
	await expect(groups.nth(0).getByTestId("tab-specs")).toBeVisible();
	await expect(groups.nth(1)).toContainText("Empty group");
	await expect(groups.nth(2).getByTestId("tab-changes")).toBeVisible();
	await expect(groups.nth(3).getByTestId("tab-files")).toBeVisible();

	changesGroup = groups.filter({ has: page.getByTestId("tab-changes") });
	await waitForLayoutSettled(page);
	const foldChanges = changesGroup.getByTestId("side-group-fold");
	await foldChanges.press("Enter");
	await expect(changesGroup).toHaveAttribute("data-folded", "true");
	const foldedAboveTarget = changesGroup.locator('[data-drop-label="Create right group above"]');
	await dragTabToTarget(page, page.getByTestId("tab-files"), foldedAboveTarget);

	groups = sideGroups(page, "right");
	await expect(groups).toHaveCount(5);
	await expect(groups.nth(0).getByTestId("tab-specs")).toBeVisible();
	await expect(groups.nth(2).getByTestId("tab-files")).toBeVisible();
	await expect(groups.nth(3).getByTestId("tab-changes")).toBeVisible();
	await expect(groups.nth(3)).toHaveAttribute("data-folded", "true");
});

test("Mod+B and Mod+J hide and restore local sides without affecting bottom", async ({ page }) => {
	await openDefaultWorkbench(page);

	await pressPlatformShortcut(page, "b");
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();
	await expect(page.getByTestId("left-nav")).toHaveCount(0);

	await pressPlatformShortcut(page, "j");
	await expect(page.getByTestId("right-layout-rail")).toBeVisible();
	await expect(page.getByTestId("right-stack")).toHaveCount(0);
	await expect(page.getByTestId("terminal-instance")).toHaveCount(1);
	await waitForLayoutSettled(page);

	await reloadDefaultWorkbench(page);
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();
	await expect(page.getByTestId("right-layout-rail")).toBeVisible();

	await pressPlatformShortcut(page, "b");
	await pressPlatformShortcut(page, "j");
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect(page.getByTestId("right-stack")).toBeVisible();
	await waitTerminalReady(page);
});

test("keyboard and menu commands reorder, search, recursively split, and explicitly remove empty groups", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await collapseToOneCenterGroup(page);
	await page.getByTestId("tab-projects").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Hide left side" }).click();
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();
	await page.getByRole("button", { name: "Show left side" }).click();
	await expect(page.getByTestId("left-nav")).toBeVisible();

	await page.getByTestId("tab-files").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Close", exact: true }).click();
	await expect(page.getByTestId("tab-files")).toHaveCount(0);
	await page.getByTestId("tab-changes").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Show Files" }).click();
	await expect(page.getByTestId("tab-files")).toBeVisible();
	await page.getByTestId("tab-specs").getByRole("tab").focus();
	await page.keyboard.press("Delete");
	await expect(page.getByTestId("tab-specs")).toHaveCount(0);
	await page.getByTestId("tab-changes").click({ button: "right" });
	await page.getByRole("menuitem", { name: "Show Specs" }).click();
	await expect(page.getByTestId("tab-specs")).toBeVisible();

	await openKeptFiles(page, ["README.md", "notes.txt", "LINKS.md"]);
	const tabs = page.getByTestId("editor-tab");

	await tabs.filter({ hasText: "README.md" }).getByRole("tab").focus();
	await page.keyboard.press("Alt+Shift+ArrowRight");
	await expect(tabs.nth(1)).toContainText("README.md");

	const centerStrip = page.getByTestId("center-tab-strip").first();
	const searchTabs = centerStrip.getByRole("button", { name: "Search open tabs" });
	await expect(searchTabs).toHaveCount(0);

	await page.setViewportSize({ width: 620, height: 800 });
	await expect(searchTabs).toBeVisible();
	await searchTabs.click();
	await page.getByPlaceholder("Find an open tab…").fill("notes");
	await page.getByRole("option", { name: /notes\.txt/ }).click();
	await expect(tabs.filter({ hasText: "notes.txt" })).toHaveAttribute("data-active", "true");
	await expect(tabs.filter({ hasText: "notes.txt" }).getByRole("tab")).toBeFocused();
	await page.setViewportSize({ width: 1280, height: 720 });
	await expect(searchTabs).toHaveCount(0);

	await page.setViewportSize({ width: 620, height: 800 });
	await searchTabs.click();
	await expect(page.getByPlaceholder("Find an open tab…")).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 720 });
	await expect(searchTabs).toHaveCount(0);
	await page.setViewportSize({ width: 620, height: 800 });
	await expect(searchTabs).toBeVisible();
	await expect(page.getByPlaceholder("Find an open tab…")).toHaveCount(0);
	await page.setViewportSize({ width: 1280, height: 720 });

	await tabs.filter({ hasText: "notes.txt" }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Split right" }).click();
	await expect(page.getByTestId("center-group")).toHaveCount(2);
	await expect(page.getByTestId("center-split-resize")).toHaveCount(1);

	const notesGroup = page.getByTestId("center-group").filter({
		has: tabs.filter({ hasText: "notes.txt" }),
	});
	const otherGroup = page.getByTestId("center-group").filter({
		has: tabs.filter({ hasText: "README.md" }),
	});
	await notesGroup.getByRole("tab", { name: /notes\.txt/ }).focus();
	await page.keyboard.press("Control+Shift+F6");
	await expect(otherGroup.locator('[role="tab"]:focus')).toHaveCount(1);
	await page.keyboard.press("Control+F6");
	await expect(notesGroup.locator('[role="tab"]:focus')).toHaveCount(1);

	await tabs.filter({ hasText: "LINKS.md" }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Split down" }).click();
	await expect(page.getByTestId("center-group")).toHaveCount(3);
	await expect(page.getByTestId("center-split-resize")).toHaveCount(2);

	const links = tabs.filter({ hasText: "LINKS.md" });
	await links.hover();
	await links.getByTestId("editor-tab-close").click();
	await expect(page.getByTestId("center-group")).toHaveCount(3);
	await page
		.locator('[data-testid="center-group"] [data-testid="remove-layout-group"]:not([disabled])')
		.click();
	await expect(page.getByTestId("center-group")).toHaveCount(2);
	await expect(page.locator('[role="tab"]:focus')).toHaveCount(1);
});

test("each center group owns an independent preview slot", async ({ page }) => {
	await openDefaultWorkbench(page);
	await collapseToOneCenterGroup(page);
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).click();

	const notes = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	await notes.click({ button: "right" });
	await page.getByRole("menuitem", { name: "Split right" }).click();
	await expect(page.getByTestId("center-group")).toHaveCount(2);

	const readmeGroup = page
		.getByTestId("center-group")
		.filter({ has: page.getByTestId("editor-tab").filter({ hasText: "README.md" }) });
	const notesGroup = page
		.getByTestId("center-group")
		.filter({ has: page.getByTestId("editor-tab").filter({ hasText: "notes.txt" }) });
	await expect(
		readmeGroup.getByTestId("editor-tab").filter({ hasText: "README.md" }),
	).toHaveAttribute("data-preview", "true");

	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).click();
	await expect(
		notesGroup.getByTestId("editor-tab").filter({ hasText: "LINKS.md" }),
	).toHaveAttribute("data-preview", "true");
	await expect(
		readmeGroup.getByTestId("editor-tab").filter({ hasText: "README.md" }),
	).toHaveAttribute("data-preview", "true");
	await expect(page.locator('[data-testid="editor-tab"][data-preview="true"]')).toHaveCount(2);
});

test("deferred opens stay with their request-time group and reroute only when it disappears", async ({
	page,
}) => {
	type SocketMessage = Parameters<WebSocketRoute["send"]>[0];
	const pathByRequest = new Map<string, string>();
	const heldByPath = new Map<string, SocketMessage>();
	let browserSocket: WebSocketRoute | undefined;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		browserSocket = ws;
		const server = ws.connectToServer();
		ws.onMessage((message) => {
			try {
				const frame = JSON.parse(message.toString()) as {
					id?: string | number;
					method?: string;
					params?: { path?: string };
				};
				if (
					frame.id !== undefined &&
					frame.method === "fs.readFile" &&
					(frame.params?.path === "LINKS.md" || frame.params?.path === "ALERTS.md")
				) {
					pathByRequest.set(String(frame.id), frame.params.path);
				}
			} catch {}
			server.send(message);
		});
		server.onMessage((message) => {
			try {
				const frame = JSON.parse(message.toString()) as { id?: string | number };
				const path = frame.id === undefined ? undefined : pathByRequest.get(String(frame.id));
				if (path) {
					heldByPath.set(path, message);
					return;
				}
			} catch {}
			ws.send(message);
		});
	});
	const release = async (path: string): Promise<void> => {
		await expect.poll(() => heldByPath.has(path)).toBe(true);
		const message = heldByPath.get(path);
		if (!message || !browserSocket) throw new Error(`missing held response for ${path}`);
		heldByPath.delete(path);
		browserSocket.send(message);
	};

	await openDefaultWorkbench(page);
	await collapseToOneCenterGroup(page);
	await openKeptFiles(page, ["README.md", "notes.txt"]);
	await page.getByTestId("editor-tab").filter({ hasText: "notes.txt" }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Split right" }).click();
	await expect(page.getByTestId("center-group")).toHaveCount(2);

	const readme = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	const notes = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	await readme.click();
	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).click();
	await expect.poll(() => heldByPath.has("LINKS.md")).toBe(true);
	await notes.click();
	await release("LINKS.md");

	const origin = page.getByTestId("center-group").filter({ has: readme });
	const originId = await origin.getAttribute("data-group-id");
	if (!originId) throw new Error("origin group has no id");
	await expect(origin.getByTestId("editor-tab").filter({ hasText: "LINKS.md" })).toHaveAttribute(
		"data-active",
		"false",
	);
	await expect(notes).toHaveAttribute("data-active", "true");

	await readme.click();
	await page.getByTestId("file-node").filter({ hasText: "ALERTS.md" }).click();
	await expect.poll(() => heldByPath.has("ALERTS.md")).toBe(true);
	for (const name of ["README.md", "LINKS.md"]) {
		const tab = page.getByTestId("editor-tab").filter({ hasText: name });
		await tab.hover();
		await tab.getByTestId("editor-tab-close").click();
	}
	await page
		.locator(`[data-testid="center-group"][data-group-id="${originId}"]`)
		.getByTestId("remove-layout-group")
		.click();
	await expect(page.getByTestId("center-group")).toHaveCount(1);
	await release("ALERTS.md");
	await expect(page.getByTestId("editor-tab").filter({ hasText: "ALERTS.md" })).toHaveAttribute(
		"data-active",
		"true",
	);
});

test("pointer drag exposes deterministic split targets and moves one tab", async ({ page }) => {
	await openDefaultWorkbench(page);
	await collapseToOneCenterGroup(page);
	await openKeptFiles(page, ["README.md", "notes.txt"]);
	const readme = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	const readmeBox = await readme.boundingBox();
	if (!readmeBox) throw new Error("README tab has no box");
	await page.mouse.move(readmeBox.x + readmeBox.width / 2, readmeBox.y + readmeBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(readmeBox.x + readmeBox.width / 2 + 12, readmeBox.y + 8, { steps: 4 });
	const reorderTarget = page.locator('[data-drop-label="Insert after notes.txt"]');
	await expect(reorderTarget).toBeVisible();
	const reorderBox = await reorderTarget.boundingBox();
	if (!reorderBox) throw new Error("tab reorder target has no box");
	await page.mouse.move(reorderBox.x + reorderBox.width / 2, reorderBox.y + reorderBox.height / 2, {
		steps: 8,
	});
	await page.mouse.up();
	await expect(page.getByTestId("editor-tab").nth(0)).toContainText("notes.txt");
	await expect(page.getByTestId("editor-tab").nth(1)).toContainText("README.md");

	const dragged = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	const box = await dragged.boundingBox();
	if (!box) throw new Error("drag tab has no box");

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, { steps: 4 });
	const splitTarget = page.locator('[data-drop-label="Split right"]');
	await expect(splitTarget).toBeVisible();
	const targetBox = await splitTarget.boundingBox();
	if (!targetBox) throw new Error("split target has no box");
	await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
		steps: 8,
	});
	await page.mouse.up();

	await expect(page.getByTestId("center-group")).toHaveCount(2);
	await expect(page.getByTestId("editor-tab")).toHaveCount(2);
	await expect(page.getByTestId("center-group").filter({ has: dragged })).toHaveCount(1);
});

test("applying the Review preset preserves resources and installs its vertical center topology", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await openKeptFiles(page, ["README.md", "notes.txt"]);

	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-layout").click();
	const reviewPreset = page.getByTestId("layout-preset").filter({ hasText: "Review" });
	await reviewPreset.getByRole("button", { name: "Apply now…" }).click();
	await page.getByTestId("layout-apply-confirm").click();

	await expect(page.getByTestId("center-group")).toHaveCount(2);
	await expect(page.getByTestId("editor-tab")).toHaveCount(2);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(sideGroups(page, "left")).toHaveCount(1);
	await expect(sideGroups(page, "right")).toHaveCount(2);
	await expect(page.getByTestId("bottom-group")).toHaveCount(1);
	await expect(page.getByTestId("bottom-group")).toContainText("Terminal 1");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("heading", { name: "Layout" })).toBeHidden();
	await expect
		.poll(async () => {
			const workbench = await page.getByTestId("workbench").boundingBox();
			const right = await page.getByTestId("right-stack").boundingBox();
			return workbench && right ? right.width / workbench.width : 0;
		})
		.toBeGreaterThan(0.3);
	await expect(page.getByTestId("center-split-resize")).toHaveAttribute(
		"aria-orientation",
		"horizontal",
	);
});

test("custom presets synchronize while defaults and group limits remain window-local", async ({
	page,
	context,
}) => {
	await openDefaultWorkbench(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-layout").click();

	await page.getByRole("textbox", { name: "Custom preset name" }).fill("My workbench");
	await page.getByRole("button", { name: "Save preset" }).click();
	let custom = page.getByTestId("layout-preset").filter({ hasText: "My workbench" });
	await expect(custom).toBeVisible();
	await custom.getByRole("button", { name: "Rename My workbench" }).click();
	await page.getByRole("textbox", { name: "Rename My workbench" }).fill("My renamed workbench");
	await page.getByRole("button", { name: "Save My workbench name" }).click();
	custom = page.getByTestId("layout-preset").filter({ hasText: "My renamed workbench" });
	await expect(custom).toBeVisible();
	await custom.getByRole("button", { name: "Set default" }).click();
	await expect(custom).toHaveAttribute("data-default", "true");

	const sideLimit = page.getByRole("spinbutton", { name: "Maximum side groups" });
	await sideLimit.fill("7");
	await page.getByRole("button", { name: "Save side group limit" }).click();
	await expect(sideLimit).toHaveValue("7");
	await expect(page.getByRole("button", { name: "Save side group limit" })).toBeDisabled();

	const bottomLimit = page.getByRole("spinbutton", { name: "Maximum bottom groups" });
	await bottomLimit.fill("4");
	await page.getByRole("button", { name: "Save bottom group limit" }).click();
	await expect(bottomLimit).toHaveValue("4");
	await expect(page.getByRole("button", { name: "Save bottom group limit" })).toBeDisabled();

	const peer = await context.newPage();
	await peer.goto("/");
	await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await peer.getByTestId("open-settings").click();
	await peer.getByTestId("settings-nav-layout").click();
	const peerCustom = peer.getByTestId("layout-preset").filter({ hasText: "My renamed workbench" });
	await expect(peerCustom).toBeVisible();
	await expect(peerCustom).not.toHaveAttribute("data-default", "true");
	await expect(peer.getByRole("spinbutton", { name: "Maximum side groups" })).toHaveValue("6");

	await custom.getByRole("button", { name: "Delete My renamed workbench" }).click();
	await expect(custom).toHaveCount(0);
	await expect(peerCustom).toHaveCount(0);
	await peer.close();
	await expect(page.getByTestId("layout-preset").filter({ hasText: "Balanced" })).toHaveAttribute(
		"data-default",
		"true",
	);
});

test("Layout settings controls keep their container-preset max-widths", async ({ page }) => {
	await openDefaultWorkbench(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-layout").click();

	await expect(page.getByTestId("layout-preset-save-row")).toHaveCSS("max-width", "512px");
	await expect(page.getByTestId("layout-group-limits")).toHaveCSS("max-width", "384px");
});

test("an accepted side-group overage is grandfathered without allowing further growth", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-layout").click();
	let sideLimit = page.getByRole("spinbutton", { name: "Maximum side groups" });
	await sideLimit.fill("3");
	await page.getByRole("button", { name: "Save side group limit" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

	await page.getByTestId("terminal-tab").click({ button: "right" });
	await page.getByRole("menuitem", { name: "New right group at bottom", exact: true }).click();
	await expect(sideGroups(page, "right")).toHaveCount(3);

	await createWorkspaceViaDialog(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-nav-layout").click();
	sideLimit = page.getByRole("spinbutton", { name: "Maximum side groups" });
	await sideLimit.fill("2");
	await page.getByRole("button", { name: "Save side group limit" }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(sideGroups(page, "right")).toHaveCount(3);
	await page.getByTestId("tab-files").click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: /^New right group at top/ })).toBeDisabled();
	await expect(page.getByRole("menuitem", { name: /^New right group at bottom/ })).toBeDisabled();
	await page.keyboard.press("Escape");

	await page.getByTestId("terminal-tab").click({ button: "right" });
	await expect(
		page.getByRole("menuitem", { name: /New right group at bottom — limited to 2/ }),
	).toBeDisabled();
	await expect(
		page.getByRole("menuitem", { name: /New right group at top — limited to 2/ }),
	).toBeDisabled();
	await page.keyboard.press("Escape");
	await expect(sideGroups(page, "right")).toHaveCount(3);
});

test("a narrow viewport compresses locally without rewriting recursive topology", async ({
	page,
}) => {
	await openDefaultWorkbench(page);
	await collapseToOneCenterGroup(page);
	await openKeptFiles(page, ["README.md", "notes.txt"]);
	await page.getByTestId("editor-tab").filter({ hasText: "notes.txt" }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Split right" }).click();
	await expect(page.getByTestId("center-group")).toHaveCount(2);

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByTestId("workbench")).toBeVisible();
	await expect(page.getByTestId("center-group")).toHaveCount(2);
	await expect(page.getByTestId("bottom-group")).toHaveCount(1);
	const bounds = await page.getByTestId("workbench").boundingBox();
	if (!bounds) throw new Error("workbench has no box");
	expect(bounds.x).toBeGreaterThanOrEqual(0);
	expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
	await page.getByTestId("editor-tab").filter({ hasText: "README.md" }).click({ button: "right" });
	await expect(page.getByRole("menuitem", { name: /Split right/ })).toBeDisabled();
	await page.keyboard.press("Escape");

	await reloadDefaultWorkbench(page);
	await expect(page.getByTestId("center-group")).toHaveCount(2);
});

test("frontend windows keep chat and file placement independent", async ({ page, context }) => {
	await openDefaultWorkbench(page);
	await page.getByTestId("start-chat").first().click();
	const chat = page.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(chat).toHaveCount(1);

	const peer = await context.newPage();
	await peer.goto("/");
	await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(peer);
	await defaultWorkspaceRow(peer).click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	await expect(peer.getByTestId("terminal-tab")).toHaveCount(1);
	await peer.getByTestId("new-terminal").first().click();
	await expect(peer.getByTestId("terminal-tab")).toHaveCount(2);
	await expect(page.getByTestId("terminal-tab")).toHaveCount(1);
	const peerChat = peer.locator('[data-testid="editor-tab"][data-kind="chat"]');
	await expect(peerChat).toHaveCount(0);
	await expect(chat).toHaveCount(1);

	const peerHistory = peer.getByTestId("chat-history").first();
	await expect(peerHistory).toBeVisible();
	await peerHistory.press("Enter");
	await peer.getByTestId("closed-chat-item").click();
	await expect(peerChat).toHaveCount(1);
	await expect(chat).toHaveCount(1);
	await peerChat.hover();
	await peerChat.getByTestId("editor-tab-close").click();
	await expect(peerChat).toHaveCount(0);
	await expect(chat).toHaveCount(1);

	await page.getByTestId("new-chat").first().click();
	await expect(chat).toHaveCount(2);
	await peerHistory.press("Enter");
	await expect(peer.getByTestId("closed-chat-item")).toHaveCount(2);
	await peer.keyboard.press("Escape");

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	const localFile = page.getByTestId("editor-tab").filter({ hasText: "README.md" });
	const peerFile = peer.getByTestId("editor-tab").filter({ hasText: "README.md" });
	await expect(localFile).toHaveCount(1);
	await expect(peerFile).toHaveCount(0);
	await peer.getByTestId("tab-files").click();
	await peer.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(peerFile).toHaveCount(1);
	await peerFile.hover();
	await peerFile.getByTestId("editor-tab-close").click();
	await expect(peerFile).toHaveCount(0);
	await expect(localFile).toHaveCount(1);
	await peer.close();
});

test("layout survives a transport reconnect and remains writable", async ({ page }) => {
	let socket: WebSocketRoute | undefined;
	let socketsOpened = 0;
	await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
		socketsOpened += 1;
		socket = ws;
		ws.connectToServer();
	});

	await openDefaultWorkbench(page);
	await pressPlatformShortcut(page, "b");
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();
	await socket?.close();
	await expect.poll(() => socketsOpened).toBeGreaterThan(1);
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.getByTestId("left-layout-rail")).toBeVisible();

	await pressPlatformShortcut(page, "b");
	await expect(page.getByTestId("left-nav")).toBeVisible();
});

test("another window cannot cancel or rearrange an active tab drag", async ({ page, context }) => {
	await openDefaultWorkbench(page);
	await collapseToOneCenterGroup(page);
	await openKeptFiles(page, ["README.md", "notes.txt"]);

	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await defaultWorkspaceRow(page2).getByRole("button").first().click();

	const dragged = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	const box = await dragged.boundingBox();
	if (!box) throw new Error("drag tab has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8, { steps: 4 });
	const splitTarget = page.locator('[data-drop-label="Split right"]');
	await expect(splitTarget).toBeVisible();

	await pressPlatformShortcut(page2, "b");
	await expect(page2.getByTestId("left-layout-rail")).toBeVisible();
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect(page.getByTestId("toast")).toHaveCount(0);
	const target = await splitTarget.boundingBox();
	if (!target) throw new Error("split target has no box");
	await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 });
	await page.mouse.up();
	await expect(page.getByTestId("center-group")).toHaveCount(2);
	await page2.close();
});

test("another window cannot cancel or adopt an active side resize", async ({ page, context }) => {
	await openDefaultWorkbench(page);
	const page2 = await context.newPage();
	await page2.goto("/");
	await expect(page2.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await revealFirstProjectWorkspaces(page2);
	await defaultWorkspaceRow(page2).getByRole("button").first().click();

	const before = await width(page.getByTestId("right-stack"));
	const handle = page.getByTestId("resize-right");
	const handleBox = await handle.boundingBox();
	if (!handleBox) throw new Error("right resize handle has no box");
	await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(handleBox.x - 60, handleBox.y + handleBox.height / 2, { steps: 5 });

	await pressPlatformShortcut(page2, "j");
	await expect(page2.getByTestId("right-layout-rail")).toBeVisible();
	await expect(page.getByTestId("right-panel")).toBeVisible();
	await expect(page.getByTestId("toast")).toHaveCount(0);
	await page.mouse.up();
	await expect.poll(() => width(page.getByTestId("right-stack"))).not.toBeCloseTo(before, 0);
	await expect(page2.getByTestId("right-layout-rail")).toBeVisible();
	await page2.close();
});
