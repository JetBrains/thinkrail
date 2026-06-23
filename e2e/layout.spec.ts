import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

async function width(page: import("@playwright/test").Page, testId: string): Promise<number> {
	const box = await page.getByTestId(testId).boundingBox();
	if (!box) throw new Error(`no bounding box for ${testId}`);
	return box.width;
}

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
