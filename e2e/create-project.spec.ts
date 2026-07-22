import { expect, test } from "@playwright/test";
import { openAppFresh, openFixtureProject } from "./fixtures/app";

// The three unified project-entry flows — all MOCK (no host/wire calls). Same labels/order everywhere;
// each has its own dialog; every success lands on the read-only ProjectView.

test("Welcome shows the three unified project actions", async ({ page }) => {
	await openAppFresh(page); // no projects → Welcome
	await expect(page.getByText("Create new project")).toBeVisible();
	await expect(page.getByText("Open local project")).toBeVisible();
	await expect(page.getByText("Clone from GitHub")).toBeVisible();
});

test("Welcome → Create new project: path preview + mock create lands on ProjectView", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByText("Create new project").click();
	const dialog = page.getByTestId("create-project-dialog");
	await expect(dialog.getByRole("heading", { name: "Create new project" })).toBeVisible();
	await expect(dialog.getByTestId("project-parent")).toContainText("~/code");

	await dialog.getByTestId("project-name").fill("my-project");
	await expect(dialog.getByTestId("project-path")).toContainText("~/code/my-project");

	await dialog.getByTestId("create-project-confirm").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("project-item").filter({ hasText: "my-project" })).toBeVisible();
	await expect(page.getByTestId("project-view")).toContainText("my-project");
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
});

test("Welcome → Open local project: non-git folder shows the init prompt, then opens", async ({
	page,
}) => {
	await openAppFresh(page);
	await page.getByText("Open local project").click();
	const dialog = page.getByTestId("open-project-dialog");
	await expect(dialog.getByRole("heading", { name: "Open local project" })).toBeVisible();
	await expect(dialog.getByTestId("open-folder-path")).toContainText("~/code/thinkrail");

	// Cycle to the mocked non-git folder → "Open project" reveals the init prompt.
	await dialog.getByTestId("choose-folder").click();
	await dialog.getByTestId("open-project-confirm").click();
	await expect(dialog.getByTestId("open-init-prompt")).toContainText(
		"This folder is not a git repository.",
	);
	await dialog.getByTestId("open-init-confirm").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("project-view")).toContainText("scratch");
});

test("PROJECTS rail → Clone from GitHub: validation, then a mock clone lands on ProjectView", async ({
	page,
}) => {
	await openFixtureProject(page);
	// The single PROJECTS-header button (folder-plus) opens the three-action menu.
	await page.getByTestId("add-project-menu").click();
	await expect(page.getByTestId("menu-project-open")).toContainText("Open local project");
	await page.getByTestId("menu-project-clone").click();

	const dialog = page.getByTestId("clone-project-dialog");
	await expect(dialog.getByRole("heading", { name: "Clone from GitHub" })).toBeVisible();
	// Invalid URL → validation copy + Clone disabled.
	await dialog.getByTestId("clone-url").fill("not a url");
	await expect(dialog.getByTestId("clone-invalid")).toBeVisible();
	await expect(dialog.getByTestId("clone-confirm")).toBeDisabled();

	// Valid URL → destination preview updates; mock clone succeeds → ProjectView.
	await dialog.getByTestId("clone-url").fill("https://github.com/owner/cool-repo.git");
	await expect(dialog.getByTestId("clone-path")).toContainText("~/code/cool-repo");
	await dialog.getByTestId("clone-confirm").click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId("project-view")).toContainText("cool-repo");
	await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
});
