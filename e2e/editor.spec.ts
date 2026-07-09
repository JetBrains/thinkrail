import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

test("opens a file in a center Monaco tab, focuses on re-open, and closes", async ({ page }) => {
	await openFixtureProject(page);

	// Create a workspace → its worktree files populate the All-files tree.
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();

	// Double-click → a center editor tab opens. README.md is markdown, so it opens RENDERED by default:
	// the preview shows the heading text and the source (Monaco) is not shown.
	await readme.dblclick();
	await expect(page.getByTestId("editor-tab").filter({ hasText: "README.md" })).toBeVisible();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");
	await expect(page.getByTestId("md-toggle-preview")).toHaveAttribute("data-active", "true");

	// Toggle to Source → Monaco renders the raw markdown; back to Preview restores the rendered view.
	await page.getByTestId("md-toggle-source").click();
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
	await expect(page.getByTestId("editor-pane")).toContainText("# sample-project");
	await page.getByTestId("md-toggle-preview").click();
	await expect(page.getByTestId("markdown-preview")).toContainText("sample-project");

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

test("opens a non-markdown file straight to Monaco with no rendered-view toggle", async ({
	page,
}) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await page.getByTestId("tab-files").click();

	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.dblclick();

	await expect(page.getByTestId("editor-tab").filter({ hasText: "notes.txt" })).toBeVisible();
	// Plain text → Monaco source, no markdown preview and no toggle strip.
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");
	await expect(page.getByTestId("markdown-view-toggle")).toHaveCount(0);
	await expect(page.getByTestId("markdown-preview")).toHaveCount(0);
});
