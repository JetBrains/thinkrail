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

test("the Welcome fork's “Work in project folder” enters the Default workspace — the project folder itself", async ({
	page,
}) => {
	await openFixtureProject(page);

	await enterDefaultWorkspace(page);

	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(page.getByTestId("scope-name")).toHaveText("Default");
	await expect(page.getByTestId("scope-branch")).toHaveText("main");
	await expect(page.getByTestId("scope-base")).toHaveCount(0);

	const row = defaultWorkspaceRow(page);
	await expect(page.getByTestId("workspace-item").first()).toHaveAttribute("data-kind", "default");
	await expect(row.getByTestId("workspace-name")).toHaveText("Default");
	await expect(row.getByTestId("workspace-branch")).toHaveText("main");

	const ready = page.getByTestId("workspace-ready");
	await expect(ready).toContainText("Default workspace");
	await expect(ready).toContainText("sample-project");
	await expect(ready).toContainText("on main");
	await expect(ready).toContainText("run directly in your project folder");

	await page.getByTestId("tab-files").click();
	await expect(page.getByTestId("file-node").filter({ hasText: "README.md" })).toBeVisible();

	await page.getByTestId("tab-changes").click();
	await expect(page.getByTestId("changes-empty")).toBeVisible();

	await page.getByTestId("terminal-tab").click();
	await waitTerminalReady(page);
	await runInTerminal(page, 'basename "$(pwd)"');
	await expect(visibleTerminalScreen(page)).toContainText("sample-project");
});

test("a terminal branch switch converges every Default branch label live", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);

	const row = defaultWorkspaceRow(page);
	await expect(page.getByTestId("scope-branch")).toHaveText("main");
	await expect(row.getByTestId("workspace-branch")).toHaveText("main");

	await waitTerminalReady(page);
	await runInTerminal(page, "git switch -c live-branch");

	await expect(row.getByTestId("workspace-branch")).toHaveText("live-branch");
	await expect(page.getByTestId("scope-branch")).toHaveText("live-branch");
	await expect(page.getByTestId("workspace-ready")).toContainText("on live-branch");
});

test("the Default workspace is non-removable and unique; project home stays reachable", async ({
	page,
}) => {
	await openFixtureProject(page);

	await createWorkspaceViaDialog(page);
	const row = defaultWorkspaceRow(page);
	await openWorkspaceMenu(row);
	await expect(page.getByTestId("workspace-actions")).toBeVisible();
	await expect(page.getByTestId("workspace-remove")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await openWorkspaceMenu(worktreeRows(page).first());
	await expect(page.getByTestId("workspace-remove")).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(defaultWorkspaceRow(page)).toHaveCount(1);

	await defaultWorkspaceRow(page).getByRole("button").first().click();
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	await expect(defaultWorkspaceRow(page)).toHaveAttribute("data-active", "true");
	await goProjectHome(page);
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
});
