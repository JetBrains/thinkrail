import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("relative links, images, and heading anchors work in the rendered markdown view", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).dblclick();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	await expect(preview.locator("#section-two")).toHaveCount(1);

	const img = preview.locator("img");
	await expect(img).toHaveAttribute("src", /\/files\/[^/]+\/logo\.png$/);
	await expect
		.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
		.toBeGreaterThan(0);

	await preview.getByRole("link", { name: "Section two" }).click();
	await expect(page.getByTestId("editor-tab")).toHaveCount(2);
	await expect(preview).toBeVisible();

	await preview.getByRole("link", { name: "the spec" }).click();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "SPEC.md" })).toBeVisible();
});
