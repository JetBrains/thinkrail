import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

test("Changes tab shows the active worktree's diff and swaps per workspace", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);

	// Edit a tracked file inside the worktree (outside the app), then surface it in the Changes tab.
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited by e2e\n");

	await page.getByTestId("tab-changes").click();
	const changed = page.getByTestId("change-item").filter({ hasText: "README.md" });
	await expect(changed).toHaveAttribute("data-status", "modified");

	// Clicking a changed file opens its Monaco diff tab in the center (split view by default).
	await changed.click();
	const diffTab = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTab).toHaveCount(1);
	await expect(diffTab).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toContainText("edited by e2e");

	// A markdown diff has exactly two views: Source (basic Monaco split, the default) | Rendered
	// (one htmldiff-merged rendered document with ins/del markers). No Split|Inline segment.
	await expect(page.getByTestId("diff-toggle-source")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-toggle-split")).toHaveCount(0);
	await page.getByTestId("diff-toggle-rendered").click();
	await expect(page.getByTestId("diff-toggle-rendered")).toHaveAttribute("data-active", "true");
	const renderedDiff = page.getByTestId("rendered-diff");
	await expect(renderedDiff.locator("h1")).toHaveText("sample-project");
	await expect(renderedDiff.locator("ins")).toContainText("edited by e2e");

	// Switching back to Source returns to the raw Monaco diff.
	await page.getByTestId("diff-toggle-source").click();
	await expect(page.getByTestId("diff-toggle-source")).toHaveAttribute("data-active", "true");
	await expect(renderedDiff).toHaveCount(0);

	// Re-clicking the row focuses the existing tab — one diff tab per file, never a duplicate.
	await changed.click();
	await expect(diffTab).toHaveCount(1);

	// A non-markdown diff has no Source|Rendered — just Split | Inline (per-tab).
	writeFileSync(join(worktree, "script.ts"), "export const edited = true;\n");
	await page.getByTestId("change-item").filter({ hasText: "script.ts" }).click();
	await expect(page.getByTestId("diff-pane")).toContainText("edited = true");
	await expect(page.getByTestId("diff-toggle-split")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-toggle-rendered")).toHaveCount(0);
	await page.getByTestId("diff-toggle-inline").click();
	await expect(page.getByTestId("diff-toggle-inline")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toContainText("edited = true");

	// A fresh second workspace has its own (empty) change set.
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item")).toHaveCount(2);
	await expect(page.getByTestId("changes-empty")).toBeVisible();
});

test("Changes has a List|Tree toggle; Tree groups files into folders with +/- counts", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// A changed file inside a subfolder, so the tree has a folder row to group under.
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	mkdirSync(join(worktree, "docs"), { recursive: true });
	writeFileSync(join(worktree, "docs", "notes.md"), "one\ntwo\nthree\n");

	await page.getByTestId("tab-changes").click();
	// List is the default view.
	await expect(page.getByTestId("changes-toggle-list")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("change-item").filter({ hasText: "docs/notes.md" })).toBeVisible();

	// Switch to the folder tree.
	await page.getByTestId("changes-toggle-tree").click();
	await expect(page.getByTestId("changes-toggle-tree")).toHaveAttribute("data-active", "true");

	// A `docs` folder row (default-expanded) and the file node beneath it, with a +count badge.
	await expect(page.getByTestId("change-tree-folder").filter({ hasText: "docs" })).toBeVisible();
	const fileNode = page.getByTestId("change-node").filter({ hasText: "notes.md" });
	await expect(fileNode).toBeVisible();
	await expect(fileNode).toHaveAttribute("data-status", "untracked");
	await expect(fileNode).toContainText("+3");

	// Clicking a file in the tree opens its diff tab, exactly like the list.
	await fileNode.click();
	const diffTab = page.locator('[data-testid="editor-tab"][data-kind="diff"]');
	await expect(diffTab).toHaveCount(1);
	await expect(page.getByTestId("diff-pane")).toContainText("three");

	// The view choice is app-wide: leaving Changes and returning keeps Tree selected.
	await page.getByTestId("tab-files").click();
	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("changes-toggle-tree")).toHaveAttribute("data-active", "true");
});
