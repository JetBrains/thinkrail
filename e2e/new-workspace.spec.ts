import { expect, test } from "@playwright/test";
import { openFixtureProject, worktreeRows } from "./fixtures/app";

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
	// and the IDE surfaces the user is about to enter are all scoped to it. The rail's "+" preselects the
	// isolated-workspace target.
	await expect(dialog.getByRole("heading", { name: "Create workspace" })).toBeVisible();
	await expect(dialog).toContainText("A separate checkout on its own new branch");
	// The note strip belongs to openers that seed a command (Welcome's "Set up project") — not the rail "+".
	await expect(dialog.getByTestId("ws-prompt-note")).toHaveCount(0);
	await expect(dialog).toContainText("Files, chats, changes, and terminals stay scoped to it");
	await expect(dialog.getByTestId("ws-target-worktree")).toHaveAttribute("data-active", "true");

	// The target control makes the two working modes one visible choice: toggling to "Project folder"
	// swaps the header to the truthful no-isolation copy, hides the base-branch picker (nothing gets
	// created), and relabels the submit — and toggling back restores the worktree form.
	await dialog.getByTestId("ws-target-default").click();
	await expect(dialog.getByRole("heading", { name: "Work in project folder" })).toBeVisible();
	await expect(dialog).toContainText("no isolation");
	await expect(dialog.getByTestId("ws-branch-picker")).toHaveCount(0);
	await expect(page.getByTestId("create-workspace")).toHaveText(/Start/);
	await dialog.getByTestId("ws-target-worktree").click();
	await expect(dialog.getByRole("heading", { name: "Create workspace" })).toBeVisible();
	await expect(dialog.getByTestId("ws-branch-picker")).toBeVisible();
	await expect(page.getByTestId("create-workspace")).toHaveText(/Create/);

	// Project picker defaults to the project the "+" was clicked on.
	await expect(dialog.getByTestId("ws-project-picker")).toContainText("sample-project");

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

	// The effort pill offers exactly the levels the resolved model supports, so it is interactive only
	// once a model has resolved — which needs provider auth this suite deliberately does not require.
	// Assert the invariant that holds either way; picking a level lives in new-workspace.live.spec.ts.
	const effort = dialog.getByTestId("thinking-selector");
	await expect(effort).toBeVisible();
	const modelResolved = !(await dialog.getByTestId("model-selector").textContent())?.includes(
		"Select model",
	);
	if (modelResolved) await expect(effort).toBeEnabled();
	else await expect(effort).toBeDisabled();

	// Dismissing the dialog (Escape) creates nothing (only the built-in Default row is present).
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(worktreeRows(page)).toHaveCount(0);

	// Reopen and Create with an empty prompt → a worktree is created and becomes active — and submit
	// still lands in a fresh chat with a ready composer (nothing sent; the prompt was empty).
	await page.getByTestId("add-workspace").first().click();
	await expect(dialog).toBeVisible();
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();
	await expect(worktreeRows(page)).toHaveCount(1);
	await expect(worktreeRows(page).first()).toHaveAttribute("data-active", "true");

	// The active scope stays visible after the Welcome → IDE remount, both in the tree and the global
	// context spine.
	const scope = page.getByTestId("scope-context");
	await expect(scope).toHaveAttribute("data-context", "workspace");
	await expect(scope).toContainText("sample-project");
	await expect(scope).toContainText("workspace-1");
	await expect(scope).toContainText("from main");

	// Submitting the start-working surface always lands in a chat: one fresh tab, composer ready,
	// and no user turn (the empty prompt sent nothing).
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(0);
});

test("folder-mode Start with an empty prompt lands in a fresh chat in the Default workspace", async ({
	page,
}) => {
	await openFixtureProject(page);
	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByTestId("ws-target-default").click();
	await page.getByTestId("create-workspace").click();
	await expect(dialog).toBeHidden();

	// Entered the Default (nothing was created) — and submit still lands in a ready chat there.
	await expect(page.getByTestId("scope-name")).toHaveText("Default");
	await expect(worktreeRows(page)).toHaveCount(0);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.getByTestId("chat-input")).toBeVisible();
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(0);
});

test("a project's committed skills are gated behind trust, then autocomplete", async ({ page }) => {
	await openFixtureProject(page);

	await page.getByTestId("add-workspace").first().click();
	const dialog = page.getByTestId("new-workspace-dialog");
	await expect(dialog).toBeVisible();
	const prompt = dialog.getByTestId("ws-prompt");
	const portable = dialog.getByTestId("slash-command").filter({ hasText: "/skill:e2e-portable" });

	// A freshly-opened project is untrusted (`resetState` wipes projects.json): the trust notice shows and
	// the fixture's committed `.claude/skills/e2e-portable` alias is withheld — its prefix surfaces nothing.
	await expect(dialog.getByTestId("ws-trust-notice")).toBeVisible();
	await prompt.fill("/e2e");
	await expect(portable).toHaveCount(0);

	// Grant trust → the notice clears and the project skill becomes available (truthful `skill/project`).
	await dialog.getByTestId("ws-trust-project").click();
	await expect(dialog.getByTestId("ws-trust-notice")).toBeHidden();
	await prompt.fill("/e2e");
	await expect(portable).toBeVisible();
	await expect(portable).toContainText("skill/project");

	// Escape dismisses completion rather than closing the parent dialog; changing the query reopens it.
	await prompt.press("Escape");
	await expect(dialog.getByTestId("slash-menu")).toBeHidden();
	await expect(dialog).toBeVisible();
	await prompt.fill("/e2");
	await expect(portable).toBeVisible();

	// Completion gets keyboard priority over the dialog's Enter-to-create behavior.
	await prompt.press("Enter");
	await expect(prompt).toHaveValue("/skill:e2e-portable ");
	await expect(dialog).toBeVisible();
	// Nothing was created — only the project's built-in Default row exists.
	await expect(worktreeRows(page)).toHaveCount(0);
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
	await expect(worktreeRows(page)).toHaveCount(0);

	// Plain Enter submits, matching the Create button's ↵ affordance. Clearing the prompt first keeps this
	// in the no-agent suite (an empty prompt opens the fresh chat but sends nothing) while still
	// exercising the same keydown→create() path the bug lived in.
	await prompt.fill("");
	await expect(dialog.getByTestId("workspace-naming-hint")).toHaveCount(0);
	await prompt.press("Enter");
	await expect(dialog).toBeHidden();
	await expect(worktreeRows(page)).toHaveCount(1);
	// Enter-submit lands in the fresh chat like the button does — the tab arrives async, so wait for it.
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
	await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toHaveCount(0);
});
