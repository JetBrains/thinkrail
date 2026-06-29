import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

// The New-Workspace dialog (M14), no agent required: project + base-branch pickers, the effort picker, and
// the bare-create flow. The agent kick-off (Create with a prompt → streaming chat) and the model-list
// wheel-scroll are covered in new-workspace.live.spec.ts (@agent).

test("the dialog lists local branches (no stray origin) and creates a worktree", async ({
	page,
}) => {
	await openFixtureProject(page);

	// The "+" opens the dialog (it no longer creates a workspace directly).
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();

	// Project picker defaults to the project the "+" was clicked on.
	await expect(dialog.getByTestId("ws-project-picker")).toContainText("sample-project");

	// The base-branch picker preselects the repo's default (the fixture has no remote → local `main`).
	const branchPicker = dialog.getByTestId("ws-branch-picker");
	await expect(branchPicker).toContainText("main");

	// Open it → the local branch is listed and flagged as the default; offline still lists local branches.
	await branchPicker.click();
	const mainOption = page.locator('[data-testid="branch-option"][data-branch="main"]');
	await expect(mainOption).toBeVisible();
	await expect(mainOption).toContainText("default");
	// Regression: `origin/HEAD` shortens to a bare `origin` — it must never appear as a branch option.
	await expect(page.locator('[data-testid="branch-option"][data-branch="origin"]')).toHaveCount(0);

	// Search filters the list; a no-match shows the empty state, and clearing restores it.
	await page.getByPlaceholder("Search branches…").fill("zzz-no-such-branch");
	await expect(page.getByTestId("branch-option")).toHaveCount(0);
	await expect(page.getByText("No branches found.")).toBeVisible();
	await page.getByPlaceholder("Search branches…").fill("main");
	await expect(mainOption).toBeVisible();
	await page.keyboard.press("Escape"); // close the branch popover

	// The effort picker is a pill+popover (same shape as the model picker): open it, pick a level, and the
	// pill reflects the choice.
	const effort = dialog.getByTestId("thinking-selector");
	await effort.click();
	await expect(page.getByTestId("thinking-option")).toHaveCount(6);
	await page.locator('[data-testid="thinking-option"][data-level="minimal"]').click();
	await expect(effort).toContainText("minimal");

	// Dismissing the dialog (Escape) creates nothing.
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("workspace-item")).toHaveCount(0);

	// Reopen and Create with an empty prompt → a worktree is created (no chat), and it becomes active.
	await page.getByTestId("add-workspace").first().click();
	await expect(dialog).toBeVisible();
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);
	await expect(page.getByTestId("workspace-item").first()).toHaveAttribute("data-active", "true");
	// No prompt → no chat tab was opened.
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
});
