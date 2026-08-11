import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";

test("shows files and compacts single-directory runs in the All-files tree", async ({ page }) => {
	await openFixtureProject(page);

	// Create a workspace → it becomes active → its worktree files populate the All-files tree.
	const workspace = await createWorkspaceViaDialog(page);
	mkdirSync(join(workspace.worktreePath, "compact", "only", "here"), { recursive: true });
	writeFileSync(join(workspace.worktreePath, "compact", "only", "here", "leaf.txt"), "leaf\n");
	// The created *worktree* row — `.first()` of all rows would match the pinned Default and pass
	// even if the new workspace never rendered.
	await expect(worktreeRows(page).first()).toBeVisible();

	// Specs is the right rail's default tab; files live one tab over.
	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();

	// The three single-child folders occupy one row. Expanding that row reveals the deepest directory's
	// child directly, rather than mounting one indented row per path segment.
	const folderRows = page.locator('[data-testid="file-node"][data-kind="dir"]');
	const compactFolder = folderRows.filter({ hasText: /^compact\/only\/here$/ });
	const leaf = page
		.locator('[data-testid="file-node"][data-kind="file"]')
		.filter({ hasText: /^leaf\.txt$/ });
	await expect(compactFolder).toBeVisible();
	await compactFolder.click();
	await expect(leaf).toBeVisible();

	// Shortening a live compact chain rematerializes `here` as its own row. Its directory-path expansion
	// state survives above the row components, so the leaf that was visible before the fs tick stays visible.
	mkdirSync(join(workspace.worktreePath, "compact", "only", "sibling"));
	await expect(folderRows.filter({ hasText: /^compact\/only$/ })).toBeVisible({ timeout: 10_000 });
	await expect(folderRows.filter({ hasText: /^here$/ })).toBeVisible();
	await expect(leaf).toBeVisible();
});
