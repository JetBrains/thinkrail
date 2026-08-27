import { expect, test } from "@playwright/test";
import { enterDefaultWorkspace, openFixtureProject } from "./fixtures/app";

test("Changes tool uses the custom file-diff glyph; Review uses the discuss glyph", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await expect(page.getByTestId("workspace-workbench")).toHaveAttribute(
		"data-layout-status",
		"settled",
	);

	const changesTab = page.getByTestId("tab-changes");
	const reviewTab = page.getByTestId("tab-review");
	await expect(changesTab).toBeVisible();
	await expect(reviewTab).toBeVisible();

	const mask = changesTab.locator(".custom-icon");
	await expect(mask).toHaveCount(1);
	const maskImage = await mask.evaluate((el) => getComputedStyle(el).maskImage);
	expect(maskImage).toContain("file-diff");
	const box = await mask.boundingBox();
	expect(box?.width ?? 0).toBeGreaterThan(8);

	await expect(reviewTab.locator("svg")).toHaveCount(1);
});
