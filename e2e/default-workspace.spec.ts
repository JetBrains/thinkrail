import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	goProjectHome,
	openFixtureProject,
	runInTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";

// The built-in Default workspace: every project carries exactly one (kind: "default") whose cwd is the
// project folder itself. It appears as soon as the project opens, is pinned first, and is non-removable
// and non-renamable — the "just work in my project folder" anchor for people lost in the worktree model.

test("opening a project auto-enters its Default workspace — the project folder itself", async ({
	page,
}) => {
	await openFixtureProject(page); // asserts the Default row is active (the auto-enter)

	// The IDE surface is mounted (not the Welcome screen), scoped to the Default workspace on `main`.
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(page.getByTestId("scope-name")).toHaveText("Default");
	await expect(page.getByTestId("scope-branch")).toHaveText("main");

	// Pinned first, labeled Default, with the folder's real branch on the second line.
	const row = defaultWorkspaceRow(page);
	await expect(page.getByTestId("workspace-item").first()).toHaveAttribute("data-kind", "default");
	await expect(row.getByTestId("workspace-name")).toHaveText("Default");
	await expect(row.getByTestId("workspace-branch")).toHaveText("main");

	// The empty-center receipt tells the truth: this is the project folder, not an isolated worktree.
	const ready = page.getByTestId("workspace-ready");
	await expect(ready).toContainText("Default workspace");
	await expect(ready).toContainText("sample-project");
	await expect(ready).toContainText("on main");
	await expect(ready).toContainText("run directly in your project folder");

	// The file tree shows the repo's own files (the workspace cwd is the project folder)…
	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();

	// …the Changes tab measures vs the repo's default branch (on main with a clean tree → empty)…
	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("changes-empty")).toBeVisible();

	// …and the auto-opened terminal is rooted in the project folder itself.
	await waitTerminalReady(page);
	await runInTerminal(page, 'basename "$(pwd)"');
	await expect(visibleTerminalScreen(page)).toContainText("sample-project");
});

test("the Default workspace is non-removable and unique; project home stays reachable", async ({
	page,
}) => {
	await openFixtureProject(page);

	// No Remove affordance on the Default row — while a worktree row offers one on hover.
	await createWorkspaceViaDialog(page);
	const row = defaultWorkspaceRow(page);
	await row.hover();
	await expect(row.getByTestId("workspace-remove")).toHaveCount(0);
	await worktreeRows(page).first().hover();
	await expect(worktreeRows(page).first().getByTestId("workspace-remove")).toBeVisible();

	// Re-opening the same project (the picker points at the same repo) does not duplicate the Default.
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await expect(defaultWorkspaceRow(page)).toHaveCount(1);

	// The project-home gesture still works: click the project row → Welcome; click Default → back in.
	await goProjectHome(page);
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
});
