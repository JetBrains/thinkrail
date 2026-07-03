import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("opens a file in a center Monaco tab, focuses on re-open, and closes", async ({ page }) => {
	await openFixtureProject(page);

	// Create a workspace → its worktree files populate the All-files tree.
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();

	// Double-click → a center editor tab opens and Monaco renders the file content.
	await readme.dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toBeVisible();
	await expect(page.getByTestId("editor-pane")).toContainText("sample-project");

	// Re-opening focuses the existing tab rather than duplicating it.
	await readme.dblclick();
	await expect(page.getByTestId("editor-tab")).toHaveCount(1);

	// Close it → back to the empty-center hint.
	const tab = page.getByTestId("editor-tab");
	await tab.hover();
	await tab.getByTestId("editor-tab-close").click();
	await expect(page.getByTestId("editor-tab")).toHaveCount(0);
	await expect(page.getByTestId("center-tabs")).toContainText("Open a file or start a chat");
});
