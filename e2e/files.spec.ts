import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("shows the active worktree's files in the All-files tree", async ({ page }) => {
	await openFixtureProject(page);

	// Create a workspace → it becomes active → its worktree files populate the All-files tree.
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item").first()).toBeVisible();

	// Specs is the right rail's default tab; files live one tab over.
	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
});
