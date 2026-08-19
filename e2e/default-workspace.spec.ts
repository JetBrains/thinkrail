import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	enterDefaultWorkspace,
	goProjectHome,
	openFixtureProject,
	openWorkspaceMenu,
	runInTerminal,
	visibleTerminalScreen,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";

// The built-in Default workspace: every project carries exactly one (kind: "default") whose cwd is the
// project folder itself. It appears as soon as the project opens, is pinned first, and is non-removable
// and non-renamable — the "just work in my project folder" anchor for people lost in the worktree model.
// Opening a project deliberately does NOT auto-enter it: the Welcome screen is the fork where working
// in the project folder is an explicit choice beside cutting an isolated worktree.

test("the Welcome fork's “Work in project folder” enters the Default workspace — the project folder itself", async ({
	page,
}) => {
	await openFixtureProject(page); // lands on the project's Welcome — nothing auto-entered

	// The fork card direct-enters the built-in Default workspace (no dialog).
	await enterDefaultWorkspace(page);

	// The IDE surface is mounted, scoped to the Default workspace on `main`.
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(page.getByTestId("scope-name")).toHaveText("Default");
	await expect(page.getByTestId("scope-branch")).toHaveText("main");
	// No isolation base to promise: the spine must not render "· from <base>" for the Default
	// (it would read "main · from main" here), matching the receipt's truthful framing.
	await expect(page.getByTestId("scope-base")).toHaveCount(0);

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

	// …and the auto-opened terminal is rooted in the project folder itself. Changes and the terminal share
	// a synchronized side group, so select the terminal again after inspecting Changes.
	await page.getByTestId("terminal-tab").click();
	await waitTerminalReady(page);
	await runInTerminal(page, 'basename "$(pwd)"');
	await expect(visibleTerminalScreen(page)).toContainText("sample-project");
});

test("a terminal branch switch converges every Default branch label live", async ({ page }) => {
	// The Default workspace's branch is folder-truth that moves out-of-band: it is the one workspace whose
	// branch a user can change from under the app (`git switch` in its own terminal). Every label reading it
	// must converge on the push — no manual project reload.
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);

	const row = defaultWorkspaceRow(page);
	await expect(page.getByTestId("scope-branch")).toHaveText("main");
	await expect(row.getByTestId("workspace-branch")).toHaveText("main");

	// A *content-identical* switch: nothing in the worktree changes, so only `.git/HEAD` moves — the
	// narrowest case the live path has to catch.
	await waitTerminalReady(page);
	await runInTerminal(page, "git switch -c live-branch");

	// The rail row, the top-bar spine and the empty-center receipt all follow the folder.
	await expect(row.getByTestId("workspace-branch")).toHaveText("live-branch");
	await expect(page.getByTestId("scope-branch")).toHaveText("live-branch");
	await expect(page.getByTestId("workspace-ready")).toContainText("on live-branch");
});

test("the Default workspace is non-removable and unique; project home stays reachable", async ({
	page,
}) => {
	await openFixtureProject(page);

	// No Remove item in the Default row's kebab menu — while a worktree row's menu offers one.
	await createWorkspaceViaDialog(page);
	const row = defaultWorkspaceRow(page);
	await openWorkspaceMenu(row);
	await expect(page.getByTestId("workspace-actions")).toBeVisible();
	await expect(page.getByTestId("workspace-remove")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await openWorkspaceMenu(worktreeRows(page).first());
	await expect(page.getByTestId("workspace-remove")).toBeVisible();
	// Close it — Radix's dropdown is modal (traps pointer events on the rest of the page while open), so
	// leaving it open here would block every click the rest of this test makes elsewhere.
	await page.keyboard.press("Escape");

	// Re-opening the same project (the picker points at the same repo) does not duplicate the Default,
	// and lands back on the Welcome fork (deselecting the active workspace — the project-home surface).
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(defaultWorkspaceRow(page)).toHaveCount(1);

	// The Default stays one click away in the rail: click its row → the IDE surface; the project-home
	// gesture then returns to Welcome.
	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await goProjectHome(page);
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
});
