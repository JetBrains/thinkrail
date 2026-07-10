import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// Rendered markdown: relative links open the target file as a tab, relative images load from the host
// /files route, and in-doc anchor links + heading ids work. Backed by the LINKS.md + logo.png fixtures.
test("relative links, images, and heading anchors work in the rendered markdown view", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	await page.getByTestId("file-node").filter({ hasText: "LINKS.md" }).dblclick();
	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	// Heading id from the slug transform (target of the in-doc anchor).
	await expect(preview.locator("#section-two")).toHaveCount(1);

	// The relative image resolves to the host /files route and actually loads.
	const img = preview.locator("img");
	await expect(img).toHaveAttribute("src", /\/files\/[^/]+\/logo\.png$/);
	await expect
		.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
		.toBeGreaterThan(0);

	// An in-doc anchor click stays on this tab (no navigation, no new tab).
	await preview.getByRole("link", { name: "Section two" }).click();
	await expect(page.getByTestId("editor-tab")).toHaveCount(1);
	await expect(preview).toBeVisible();

	// A relative file link opens the target file as its own editor tab.
	await preview.getByRole("link", { name: "the spec" }).click();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "SPEC.md" })).toBeVisible();
});
