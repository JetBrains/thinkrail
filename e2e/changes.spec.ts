import { writeFileSync } from "node:fs";
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
	await expect(page.getByTestId("diff-toggle-split")).toHaveAttribute("data-active", "true");

	// Split ↔ inline is a per-tab toggle in the pane header.
	await page.getByTestId("diff-toggle-inline").click();
	await expect(page.getByTestId("diff-toggle-inline")).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("diff-pane")).toContainText("edited by e2e");

	// Re-clicking the row focuses the existing tab — one diff tab per file, never a duplicate.
	await changed.click();
	await expect(diffTab).toHaveCount(1);

	// A fresh second workspace has its own (empty) change set.
	await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item")).toHaveCount(2);
	await expect(page.getByTestId("changes-empty")).toBeVisible();
});
