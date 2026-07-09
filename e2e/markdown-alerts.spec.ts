import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// GitHub-style alert callouts (`> [!NOTE]` …) render in the rendered markdown view; a plain blockquote
// (no marker) stays a quote. Backed by the ALERTS.md fixture seeded in global-setup.
test("renders GitHub-style alert callouts in the rendered markdown view", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const file = page.getByTestId("file-node").filter({ hasText: "ALERTS.md" });
	await expect(file).toBeVisible();
	await file.dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	// All five variants become callouts, tagged with their variant; the plain blockquote does not.
	const alerts = preview.getByTestId("md-alert");
	await expect(alerts).toHaveCount(5);
	for (const variant of ["note", "tip", "important", "warning", "caution"]) {
		await expect(
			preview.locator(`[data-testid="md-alert"][data-variant="${variant}"]`),
		).toHaveCount(1);
	}
	// The callout shows its label + body, and the marker text itself is gone.
	await expect(preview.locator('[data-variant="note"]')).toContainText("Note");
	await expect(preview.locator('[data-variant="note"]')).toContainText("Useful information");
	await expect(preview).not.toContainText("[!NOTE]");

	// Source view shows the raw marker again.
	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("editor-pane")).toContainText("[!NOTE]");
});
