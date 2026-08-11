import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";

async function width(page: import("@playwright/test").Page, testId: string): Promise<number> {
	const box = await page.getByTestId(testId).boundingBox();
	if (!box) throw new Error(`no bounding box for ${testId}`);
	return box.width;
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
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 12 });
	await page.mouse.up();

	const after = await width(page, "left-nav");
	expect(after).toBeGreaterThan(before + 80);
});
