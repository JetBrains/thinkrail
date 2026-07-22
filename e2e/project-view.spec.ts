import { expect, test } from "@playwright/test";
import { openFixtureProject } from "./fixtures/app";

// The read-only project view opens when a project is selected. Its file tree/contents are MOCKED (no
// host repo read), so this runs in the no-agent suite.

test("selecting a project opens the read-only project view with the Edit dropdown", async ({
	page,
}) => {
	await openFixtureProject(page); // opens + selects the fixture project

	const view = page.getByTestId("project-view");
	await expect(view).toBeVisible();
	await expect(view).toContainText("sample-project");
	// The read-only badge and the mock file list are shown; the Welcome screen is not.
	await expect(page.getByTestId("readonly-badge")).toBeVisible();
	await expect(page.getByTestId("project-file").first()).toBeVisible();
	await expect(page.getByTestId("welcome")).toHaveCount(0);

	// The Edit dropdown offers exactly two options, worktree first (Recommended).
	await page.getByTestId("project-edit").click();
	const newWorktree = page.getByTestId("edit-new-worktree");
	await expect(newWorktree).toBeVisible();
	await expect(newWorktree).toContainText("Recommended");
	await expect(page.getByTestId("edit-inline")).toBeVisible();

	// "Edit in new worktree" opens the Create-workspace modal, pre-scoped to this project.
	await newWorktree.click();
	await expect(page.getByTestId("new-workspace-dialog")).toBeVisible();
});

test("'Edit inline here' turns off read-only for the session", async ({ page }) => {
	await openFixtureProject(page);
	await expect(page.getByTestId("readonly-badge")).toBeVisible();

	await page.getByTestId("project-edit").click();
	await page.getByTestId("edit-inline").click();

	// Read-only is off → the badge is gone (editing is enabled inline for this session).
	await expect(page.getByTestId("readonly-badge")).toHaveCount(0);
	await expect(page.getByTestId("project-view")).toBeVisible();
});

test("the project row's hover gear opens the project settings screen", async ({ page }) => {
	await openFixtureProject(page);
	// A worktree is active after a create → the project row isn't the active item; the gear still opens
	// the read-only project screen (selecting the project, leaving any workspace).
	const row = page.getByTestId("project-item").first();
	await row.hover();
	const gear = page.getByTestId("project-settings").first();
	await gear.click();
	await expect(page.getByTestId("project-view")).toBeVisible();
	await expect(page.getByTestId("project-view")).toContainText("sample-project");
	// The gear is only a shortcut: it jumps the already-open rail to the Hooks tab.
	await expect(page.getByTestId("tab-hooks")).toHaveAttribute("data-active", "true");
});

test("the project rail is contextual: Specs/All files/Scripts/Hooks, no Changes, no terminal", async ({
	page,
}) => {
	await openFixtureProject(page); // selects the project → read-only ProjectView + the project rail

	await expect(page.getByTestId("right-panel")).toBeVisible();
	await expect(page.getByTestId("tab-specs")).toBeVisible();
	await expect(page.getByTestId("tab-files")).toBeVisible();
	await expect(page.getByTestId("tab-scripts")).toBeVisible();
	await expect(page.getByTestId("tab-hooks")).toBeVisible();
	// Changes is worktree-only; the terminal is worktree-only.
	await expect(page.getByTestId("tab-changes")).toHaveCount(0);
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);

	// Scripts → the mock run list; Hooks → the create/archive command fields.
	await page.getByTestId("tab-scripts").click();
	await expect(page.getByTestId("script-item").first()).toBeVisible();
	await page.getByTestId("tab-hooks").click();
	await expect(page.getByTestId("hook-on-create")).toBeVisible();
	await expect(page.getByTestId("hook-on-archive")).toBeVisible();
});
