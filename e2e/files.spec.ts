import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("shows the active worktree's files in the All-files tree", async ({ page }) => {
	await openFixtureProject(page);

	// Create a workspace → it becomes active → its worktree files populate the All-files tree.
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item").first()).toBeVisible();

	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
});
