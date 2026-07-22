import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

// The opened-documents History (view state, per workspace, localStorage) + the single-chat restriction.
// No agent needed: files/diffs open without a session, and the "New chat" strip creator is gone
// regardless. (The cap-at-10 + dedupe rules are unit-tested in store/appStore.test.ts.)

test("History lists opened files + diffs (recent-first), clicking reopens, and no new-chat creator", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	// Empty center → the workspace receipt carries the single-chat bootstrap (the ONLY chat entry point).
	await expect(page.getByTestId("start-chat")).toBeVisible();

	// Open two files from the All-files tree (notes.txt first, then README.md → README is the most recent).
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toBeVisible();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toBeVisible();

	// The tab strip is present but the parallel-chat creator (the `+`) is gone — only ever one chat tab.
	await expect(page.getByTestId("new-chat")).toHaveCount(0);

	// A diff is a document too: edit README in the worktree, open its diff from Changes.
	const worktree = join(E2E_DATA_DIR, "worktrees", "sample-project", "workspace-1");
	writeFileSync(join(worktree, "README.md"), "# sample-project\n\nedited for history\n");
	await page.getByTestId("tab-changes").click();
	await page.getByTestId("change-item").filter({ hasText: "README.md" }).click();
	await expect(page.locator('[data-testid="editor-tab"][data-kind="diff"]')).toBeVisible();

	// History (recent-first): the README diff is newest, then README file, then notes.txt.
	await page.getByTestId("doc-history").click();
	const items = page.getByTestId("doc-history-item");
	await expect(items).toHaveCount(3);
	await expect(items.first()).toHaveAttribute("data-kind", "diff");
	await expect(items.first()).toContainText("README.md");
	await expect(items.nth(2)).toContainText("notes.txt");
	// Close the menu.
	await page.keyboard.press("Escape");

	// Close the notes.txt tab, then reopen it from History → it comes back as a center tab.
	const notesTab = page.getByTestId("editor-tab").filter({ hasText: "notes.txt" });
	await notesTab.hover();
	await notesTab.getByTestId("editor-tab-close").click();
	await expect(notesTab).toHaveCount(0);

	await page.getByTestId("doc-history").click();
	await page.getByTestId("doc-history-item").filter({ hasText: "notes.txt" }).click();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toBeVisible();
});

test("the opened-documents History survives a reload (localStorage view state)", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "notes.txt" }).dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toBeVisible();

	// Reload: tabs are in-memory (gone), but the History is persisted. Re-enter the workspace and open a
	// file so the tab strip (and its History icon) is present again.
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	// Selecting the project opens its read-only view; enter the workspace by clicking its row.
	await page.getByTestId("project-item").first().click();
	await page.getByTestId("workspace-item").first().getByRole("button").first().click();
	await page.getByTestId("tab-files").click();
	await page.getByTestId("file-node").filter({ hasText: "README.md" }).dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toBeVisible();

	// notes.txt — opened before the reload — is still in History.
	await page.getByTestId("doc-history").click();
	await expect(page.getByTestId("doc-history-item").filter({ hasText: "notes.txt" })).toBeVisible();
});
