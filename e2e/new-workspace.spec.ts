import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

// The New-Workspace dialog, no agent required: project + base-branch pickers, the effort picker, and
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

	// The operation and its scope are explicit before any controls: this is a separate checkout/branch,
	// and the IDE surfaces the user is about to enter are all scoped to it.
	await expect(dialog.getByRole("heading", { name: "Create new worktree" })).toBeVisible();
	await expect(dialog).toContainText("A separate checkout on its own new branch");
	await expect(dialog).toContainText("Files, chats, changes, and terminals stay scoped to it");

	// Project picker defaults to the project the "+" was clicked on; the read-only root-path chip is shown.
	await expect(dialog.getByTestId("ws-project-picker")).toContainText("sample-project");
	await expect(dialog.getByTestId("ws-root-path")).toContainText(".thinkrail/worktrees");

	// The base-branch picker preselects the repo's default (the fixture has no remote → local `main`).
	const branchPicker = dialog.getByTestId("ws-branch-picker");
	await expect(branchPicker).toContainText("From");
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
	await expect(page.getByTestId("thinking-option")).toHaveCount(7);
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

	// The active scope stays visible after the Welcome → IDE remount, both in the tree and the global
	// context spine. The empty center is a persistent receipt, not a generic blank-state prompt.
	const scope = page.getByTestId("scope-context");
	await expect(scope).toHaveAttribute("data-context", "workspace");
	await expect(scope).toContainText("sample-project");
	await expect(scope).toContainText("workspace-1");
	// The base branch is now a tooltip on the breadcrumb name crumb, not inline text (still on the
	// workspace-ready receipt below).
	const ready = page.getByTestId("workspace-ready");
	await expect(ready).toContainText("Workspace ready");
	await expect(ready).toContainText("workspace-1");
	await expect(ready).toContainText("from main");
	await expect(ready).toContainText("Files, chats, changes, and terminals are scoped");

	// No prompt → no chat tab was opened.
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
});

test("Enter in the prompt creates; Shift+Enter inserts a newline", async ({ page }) => {
	await openFixtureProject(page);

	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	const prompt = dialog.getByTestId("ws-prompt");

	// Regression: plain Enter used to insert a newline; only Shift+Enter should. Shift+Enter keeps the
	// dialog open and adds a line break — it must NOT create.
	await prompt.fill("first line");
	await expect(dialog.getByTestId("workspace-naming-hint")).toContainText(
		"name the workspace and branch from your request",
	);
	await prompt.press("Shift+Enter");
	await prompt.pressSequentially("second line");
	await expect(prompt).toHaveValue("first line\nsecond line");
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId("workspace-item")).toHaveCount(0);

	// Plain Enter submits, matching the Create button's ↵ affordance. Clearing the prompt first keeps this
	// in the no-agent suite (an empty prompt creates a bare worktree with no chat kick-off) while still
	// exercising the same keydown→create() path the bug lived in.
	await prompt.fill("");
	await expect(dialog.getByTestId("workspace-naming-hint")).toHaveCount(0);
	await prompt.press("Enter");
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(0);
});
