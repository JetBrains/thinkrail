import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

test("shows the active worktree's files in the All-files tree", async ({ page }) => {
	await openFixtureProject(page);

	// Create a workspace → it becomes active → its worktree files populate the All-files tree.
	await createWorkspaceViaDialog(page);
	// The created *worktree* row — `.first()` of all rows would match the pinned Default and pass
	// even if the new workspace never rendered.
	await expect(worktreeRows(page).first()).toBeVisible();

	// Specs is the right rail's default tab; files live one tab over.
	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();
});
