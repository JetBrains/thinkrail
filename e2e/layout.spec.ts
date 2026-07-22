import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

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

test("collapsing a side panel hides it and gives the space to the center; the toggle re-expands", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect(page.getByTestId("right-panel")).toBeVisible();

	// Collapse the left panel → its content is gone; a thin rail with the re-expand toggle remains.
	await page.getByTestId("toggle-left-panel").click();
	await expect(page.getByTestId("left-nav")).toHaveCount(0);
	await expect(page.getByTestId("left-rail-collapsed")).toBeVisible();
	// The same toggle (now in the rail) brings it back.
	await page.getByTestId("toggle-left-panel").click();
	await expect(page.getByTestId("left-nav")).toBeVisible();
	await expect(page.getByTestId("left-rail-collapsed")).toHaveCount(0);

	// Same for the right rail.
	await page.getByTestId("toggle-right-panel").click();
	await expect(page.getByTestId("right-panel")).toHaveCount(0);
	await expect(page.getByTestId("right-rail-collapsed")).toBeVisible();
	await page.getByTestId("toggle-right-panel").click();
	await expect(page.getByTestId("right-panel")).toBeVisible();
});

test("collapsed panel state persists across a reload (localStorage view state)", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("toggle-left-panel").click();
	await expect(page.getByTestId("left-rail-collapsed")).toBeVisible();

	await page.reload();
	// The left panel stays collapsed after reload (client-only view state), before any reconnect.
	await expect(page.getByTestId("left-rail-collapsed")).toBeVisible();
	await expect(page.getByTestId("left-nav")).toHaveCount(0);
});

test("the add-project menu lives on the PROJECTS row and lists the three unified actions", async ({
	page,
}) => {
	await openFixtureProject(page);
	// The add-project trigger sits in the projects list area (left-nav), not the panel's top bar.
	await expect(page.getByTestId("left-nav").getByTestId("add-project-menu")).toBeVisible();
	await page.getByTestId("add-project-menu").click();
	await expect(page.getByTestId("menu-project-create")).toContainText("Create new project");
	await expect(page.getByTestId("menu-project-open")).toContainText("Open local project");
	await expect(page.getByTestId("menu-project-clone")).toContainText("Clone from GitHub");
});
