import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	defaultWorkspaceRow,
	openAppFresh,
	openFixtureProject,
	stagePlainFolder,
	worktreeRows,
} from "./fixtures/app";
import {
	E2E_DATA_DIR,
	E2E_FIXTURE_REPO,
	E2E_PICK_DIR_POINTER,
	E2E_PLAIN_DIR,
} from "./fixtures/paths";

async function openProjectActions(page: Page, row: Locator): Promise<Locator> {
	await row.click({ button: "right" });
	const menu = page.getByTestId("project-actions");
	await expect(menu).toBeVisible();
	return menu;
}

function seedSecondRepo(): string {
	const repo = join(E2E_DATA_DIR, "second-project");
	rmSync(repo, { recursive: true, force: true });
	mkdirSync(repo, { recursive: true });
	execFileSync("git", ["-C", repo, "init", "-b", "main"]);
	execFileSync("git", ["-C", repo, "config", "user.email", "e2e@thinkrail.test"]);
	execFileSync("git", ["-C", repo, "config", "user.name", "ThinkRail E2E"]);
	writeFileSync(join(repo, "README.md"), "# second project\n");
	execFileSync("git", ["-C", repo, "add", "-A"]);
	execFileSync("git", ["-C", repo, "commit", "-m", "seed"]);
	writeFileSync(E2E_PICK_DIR_POINTER, repo);
	return repo;
}

test("opens a git repo as a project via the directory picker", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();

	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_FIXTURE_REPO) }),
	).toBeVisible();
});

test("opens a project from an explicit host path", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-enter-host-path").click();

	const dialog = page.getByTestId("open-project-path-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText("computer running ThinkRail");
	await expect(dialog.getByTestId("open-project-picker-error")).toHaveCount(0);
	const input = dialog.getByTestId("open-project-path-input");
	await expect(input).toBeFocused();
	await input.fill(E2E_FIXTURE_REPO);
	await input.press("Enter");

	await expect(dialog).toHaveCount(0);
	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_FIXTURE_REPO) }),
	).toBeVisible();
});

test("headless picker failure falls back to host-path entry", async ({ page }) => {
	writeFileSync(E2E_PICK_DIR_POINTER, "");
	try {
		await page.goto("/");
		await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();

		const dialog = page.getByTestId("open-project-path-dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId("open-project-picker-error")).toContainText(
			"No graphical session",
		);
		await dialog.getByTestId("open-project-path-input").fill(E2E_FIXTURE_REPO);
		await dialog.getByTestId("open-project-path-submit").click();

		await expect(dialog).toHaveCount(0);
		await expect(
			page.getByTestId("project-item").filter({ hasText: basename(E2E_FIXTURE_REPO) }),
		).toBeVisible();
	} finally {
		writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
	}
});

test("opening a non-git folder offers to initialise a repo, then opens it end-to-end", async ({
	page,
}) => {
	stagePlainFolder();
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	const confirmInit = page.getByTestId("confirm-init-repo");
	await expect(confirmInit).toBeVisible();
	await confirmInit.click();

	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_PLAIN_DIR) }),
	).toBeVisible();

	await createWorkspaceViaDialog(page);
	await expect(worktreeRows(page).first()).toBeVisible();
});

test("rail expansion is per-browser view state that survives a reload", async ({ page }) => {
	await openFixtureProject(page);
	const row = page.getByTestId("project-item").filter({ hasText: "sample-project" });
	const expand = row.getByTestId("project-expand");

	await expect(expand).toHaveAttribute("data-expanded", "true");
	await expect(defaultWorkspaceRow(page)).toBeVisible();

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(expand).toHaveAttribute("data-expanded", "true");
	await expect(defaultWorkspaceRow(page)).toBeVisible();

	await expand.click();
	await expect(expand).toHaveAttribute("data-expanded", "false");
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(expand).toHaveAttribute("data-expanded", "false");
	await expect(defaultWorkspaceRow(page)).toHaveCount(0);
});

test("activating a workspace in one project keeps the other project's rail expansion", async ({
	page,
}) => {
	await openFixtureProject(page);
	seedSecondRepo();
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();

	const fixtureExpand = page
		.getByTestId("project-item")
		.filter({ hasText: "sample-project" })
		.getByTestId("project-expand");
	const secondExpand = page
		.getByTestId("project-item")
		.filter({ hasText: "second-project" })
		.getByTestId("project-expand");
	await expect(secondExpand).toHaveAttribute("data-expanded", "true");
	await expect(fixtureExpand).toHaveAttribute("data-expanded", "true");

	const fixtureDefaultRow = page
		.locator("li")
		.filter({ has: page.getByTestId("project-item").filter({ hasText: "sample-project" }) })
		.locator('[data-testid="workspace-item"][data-kind="default"]');
	await fixtureDefaultRow.click();
	await expect(fixtureDefaultRow).toHaveAttribute("data-active", "true");
	await expect(page.getByTestId("center-tabs")).toBeVisible();

	await expect(secondExpand).toHaveAttribute("data-expanded", "true");
	await expect(fixtureExpand).toHaveAttribute("data-expanded", "true");
});

test("project context actions stay compact and close/reopen is lossless across clients", async ({
	page,
	context,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	const fixtureRow = page.getByTestId("project-item").filter({ hasText: "sample-project" });
	const fixtureName = fixtureRow.getByTestId("project-name");
	const expand = fixtureRow.getByTestId("project-expand");
	const addWorkspace = fixtureRow.getByTestId("add-workspace");
	await expect(expand).toBeVisible();
	await expect(addWorkspace).toBeVisible();
	await expect(expand).toHaveCSS("opacity", "1");
	await expect(addWorkspace).toHaveCSS("opacity", "1");
	await expect(fixtureRow.getByTestId("close-project")).toHaveCount(0);
	await expect(fixtureRow.getByLabel(/project actions/i)).toHaveCount(0);

	await expand.click();
	const count = fixtureRow.getByTestId("project-workspace-count");
	await expect(count).toHaveText("1");
	expect(
		await count.evaluate((element) => element.nextElementSibling?.getAttribute("data-testid")),
	).toBe("add-workspace");

	const projectActions = page.getByTestId("project-actions");
	await fixtureName.focus();
	await page.keyboard.press("Shift+F10");
	await expect(projectActions).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(fixtureName).toBeFocused();
	await fixtureName.focus();
	await page.keyboard.press("ContextMenu");
	await expect(projectActions).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(fixtureName).toBeFocused();

	const fixtureBox = await fixtureRow.boundingBox();
	if (!fixtureBox) throw new Error("Fixture project row has no bounding box");
	const pointer = { x: fixtureBox.x + 72, y: fixtureBox.y + fixtureBox.height / 2 };
	await page.mouse.click(pointer.x, pointer.y, { button: "right" });
	await expect(projectActions).toBeVisible();
	await expect(fixtureRow).toHaveAttribute("data-menu-open", "true");
	await expect(page.getByTestId("center-tabs")).toBeVisible();
	const menuBox = await projectActions.boundingBox();
	if (!menuBox) throw new Error("Project context menu has no bounding box");
	expect(Math.abs(menuBox.x - pointer.x)).toBeLessThan(8);
	expect(Math.abs(menuBox.y - pointer.y)).toBeLessThan(8);

	const createFromMenu = page.getByTestId("project-menu-create-workspace");
	const openExistingFromMenu = page.getByTestId("project-menu-open-existing-worktree");
	const closeFromMenu = page.getByTestId("project-menu-close");
	const menuParts = projectActions.locator('[role="menuitem"], [role="separator"]');
	await expect(menuParts).toHaveCount(4);
	await expect(menuParts.nth(0)).toHaveText("Create workspace");
	await expect(menuParts.nth(1)).toHaveText("Open existing worktree…");
	await expect(menuParts.nth(2)).toHaveAttribute("role", "separator");
	await expect(menuParts.nth(3)).toHaveText("Close project");
	await expect(createFromMenu.locator("svg.remixicon")).toHaveCount(1);
	await expect(openExistingFromMenu.locator("svg.remixicon")).toHaveCount(1);
	await expect(closeFromMenu.locator("svg.remixicon")).toHaveCount(1);
	await page.keyboard.press("ArrowDown");
	await expect(createFromMenu).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(openExistingFromMenu).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(closeFromMenu).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(fixtureName).toBeFocused();
	await expect(fixtureRow).toHaveAttribute("data-menu-open", "false");

	await fixtureRow.dispatchEvent("pointerdown", {
		pointerType: "touch",
		pointerId: 1,
		isPrimary: true,
		button: 0,
		buttons: 1,
		clientX: pointer.x,
		clientY: pointer.y,
	});
	await fixtureRow.dispatchEvent("pointermove", {
		pointerType: "touch",
		pointerId: 1,
		isPrimary: true,
		button: 0,
		buttons: 1,
		clientX: pointer.x + 16,
		clientY: pointer.y,
	});
	await page.waitForTimeout(750);
	await expect(projectActions).toHaveCount(0);
	await fixtureRow.dispatchEvent("pointerup", {
		pointerType: "touch",
		pointerId: 1,
		isPrimary: true,
		button: 0,
		buttons: 0,
		clientX: pointer.x + 16,
		clientY: pointer.y,
	});

	await fixtureRow.dispatchEvent("pointerdown", {
		pointerType: "touch",
		pointerId: 2,
		isPrimary: true,
		button: 0,
		buttons: 1,
		clientX: pointer.x,
		clientY: pointer.y,
	});
	await page.waitForTimeout(550);
	await expect(projectActions).toHaveCount(0);
	await expect(projectActions).toBeVisible({ timeout: 500 });
	await fixtureRow.dispatchEvent("pointerup", {
		pointerType: "touch",
		pointerId: 2,
		isPrimary: true,
		button: 0,
		buttons: 0,
		clientX: pointer.x,
		clientY: pointer.y,
	});
	await page.keyboard.press("Escape");
	await expect(fixtureName).toBeFocused();

	await openProjectActions(page, fixtureRow);
	await page.getByTestId("project-menu-create-workspace").click();
	await expect(page.getByTestId("new-workspace-dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(fixtureName).toBeFocused();

	const secondRepo = seedSecondRepo();
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("welcome-title")).toHaveText("second-project");

	const observer = await context.newPage();
	await observer.goto("/");
	await expect(observer.getByTestId("connection-status")).toHaveAttribute(
		"data-status",
		"connected",
	);
	await expect(observer.getByTestId("welcome-title")).toHaveText("second-project");

	const secondRow = page.getByTestId("project-item").filter({ hasText: "second-project" });
	const secondName = secondRow.getByTestId("project-name");
	await openProjectActions(page, secondRow);
	await page.getByTestId("project-menu-close").click();
	const confirm = page.getByTestId("confirm-dialog");
	await expect(confirm).toBeVisible();
	await expect(confirm).toHaveAttribute("role", "alertdialog");
	await expect(confirm).toContainText("Close second-project?");
	await expect(confirm).toContainText(
		"Removes this project from the open projects list. Its repository, workspaces, chats, and running activity are kept. Reopen it from Add project → Recents.",
	);
	const cancel = confirm.getByRole("button", { name: "Cancel" });
	await expect(cancel).toBeFocused();
	await cancel.click();
	await expect(secondRow).toBeVisible();
	await expect(secondName).toBeFocused();

	await openProjectActions(page, secondRow);
	await page.getByTestId("project-menu-close").click();
	await page.getByTestId("dialog-overlay").click({ position: { x: 4, y: 4 } });
	await expect(confirm).toHaveCount(0);
	await expect(secondName).toBeFocused();
	await openProjectActions(page, secondRow);
	await page.getByTestId("project-menu-close").click();
	await expect(confirm).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(confirm).toHaveCount(0);
	await expect(secondName).toBeFocused();

	await openProjectActions(page, secondRow);
	await page.getByTestId("project-menu-close").click();
	await page.getByTestId("confirm-close-project").click();
	await expect(secondRow).toHaveCount(0);
	await expect(
		observer.getByTestId("project-item").filter({ hasText: "second-project" }),
	).toHaveCount(0);
	await expect(page.getByTestId("welcome-title")).toHaveText("sample-project");
	await expect(observer.getByTestId("welcome-title")).toHaveText("sample-project");
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(fixtureName).toBeFocused();

	const remainingRow = page.getByTestId("project-item").filter({ hasText: "sample-project" });
	await openProjectActions(page, remainingRow);
	await page.getByTestId("project-menu-close").click();
	await page.getByTestId("confirm-close-project").click();
	await expect(page.getByTestId("project-item")).toHaveCount(0);
	await expect(observer.getByTestId("project-item")).toHaveCount(0);
	await expect(page.getByTestId("welcome-title")).toHaveText("ThinkRail");
	await expect(observer.getByTestId("welcome-title")).toHaveText("ThinkRail");
	await expect(page.getByTestId("add-project-menu")).toBeFocused();

	await page.getByTestId("add-project-menu").click();
	const fixtureRecent = page.getByRole("menuitem").filter({ hasText: E2E_FIXTURE_REPO });
	await expect(fixtureRecent).toBeVisible();
	await expect(page.getByRole("menuitem").filter({ hasText: secondRepo })).toBeVisible();
	await fixtureRecent.click();
	await expect(page.getByTestId("welcome-title")).toHaveText("sample-project");
	await expect(
		observer.getByTestId("project-item").filter({ hasText: "sample-project" }),
	).toBeVisible();
	await expect(observer.getByTestId("welcome-title")).toHaveText("sample-project");
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect(worktreeRows(page).filter({ hasText: workspace.name })).toBeVisible();

	await openAppFresh(page);
});
