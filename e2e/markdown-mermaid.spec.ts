import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("renders mermaid fences as diagrams in the rendered markdown view", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const file = page.getByTestId("file-node").filter({ hasText: "DIAGRAM.md" });
	await expect(file).toBeVisible();
	await file.dblclick();

	const preview = page.getByTestId("markdown-preview");
	await expect(preview).toBeVisible();

	await expect(preview.getByTestId("mermaid-svg").locator("svg")).toBeVisible({ timeout: 20_000 });
	await expect(preview.getByTestId("mermaid-svg")).toHaveCount(1);
	const error = preview.getByTestId("mermaid-error");
	await expect(error).toHaveCount(1);
	await expect(error).toContainText("broken");

	await expect(preview.locator("pre.shiki", { hasText: "plain-fence-stays-code" })).toBeVisible();

	await preview.getByTestId("mermaid-fullscreen").click();
	const dialog = page.getByTestId("mermaid-fullscreen-dialog");
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);

	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("editor-pane")).toContainText("flowchart TD; Start --> Finish");
});
