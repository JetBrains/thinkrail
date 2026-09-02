import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("a parent-relative file link cannot escape into browser navigation", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "styles" }).click();
	await page.getByTestId("file-node").filter({ hasText: "COLOR.md" }).dblclick();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).click();
	const priorPreview = page.getByTestId("editor-tab").filter({ hasText: "LINKS.md" });
	await expect(priorPreview).toHaveAttribute("data-preview", "true");
	await page.getByTestId("editor-tab").filter({ hasText: "COLOR.md" }).click();
	await expect(preview.getByRole("heading", { name: "Colour system" })).toBeVisible();

	const link = preview.getByTestId("markdown-file-link");
	await expect(link).toHaveAttribute("data-path", "themes/SPEC.md");
	await expect(link).not.toHaveAttribute("href", /.+/);
	const urlBefore = page.url();
	const pagesBefore = page.context().pages().length;

	await link.click();

	await expect(preview.getByRole("heading", { name: "Theme spec target" })).toBeVisible();
	const targetTab = page.getByTestId("editor-tab").filter({ hasText: "SPEC.md" });
	await expect(targetTab).toHaveAttribute("data-preview", "true");
	await expect(priorPreview).toHaveCount(0);
	expect(page.url()).toBe(urlBefore);
	expect(page.context().pages()).toHaveLength(pagesBefore);
});

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

	await preview.getByTestId("markdown-file-link").click();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "SPEC.md" })).toBeVisible();
});
