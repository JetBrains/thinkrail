import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
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

	// "Open project" invokes the host's native directory picker — stubbed to E2E_FIXTURE_REPO in e2e.
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();

	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_FIXTURE_REPO) }),
	).toBeVisible();
});

test("opening a non-git folder offers to initialise a repo, then opens it end-to-end", async ({
	page,
}) => {
	// A plain (non-git) folder for the stubbed picker to return.
	stagePlainFolder();
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	// "Open project" — the folder isn't a repo, so instead of failing silently we're asked to initialise.
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	const confirmInit = page.getByTestId("confirm-init-repo");
	await expect(confirmInit).toBeVisible();
	await confirmInit.click();

	// The initialised folder now shows up as a project…
	await expect(
		page.getByTestId("project-item").filter({ hasText: basename(E2E_PLAIN_DIR) }),
	).toBeVisible();

	// …and it's usable end-to-end: a workspace (git worktree) can be created, which needs the HEAD the
	// initial commit gave the fresh repo.
	await createWorkspaceViaDialog(page);
	// The created *worktree* row — `.first()` of all rows would match the pinned Default and pass
	// even if the new workspace never rendered.
	await expect(worktreeRows(page).first()).toBeVisible();
});

test("project controls stay visible and close/reopen is lossless across clients", async ({
	page,
	context,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	const fixtureRow = page.getByTestId("project-item").filter({ hasText: "sample-project" });
	const close = fixtureRow.getByTestId("close-project");
	const addWorkspace = fixtureRow.getByTestId("add-workspace");
	await expect(close).toBeVisible();
	await expect(addWorkspace).toBeVisible();
	await expect(close).toHaveCSS("opacity", "1");
	await expect(addWorkspace).toHaveCSS("opacity", "1");
	expect(
		await close.evaluate((element) => element.nextElementSibling?.getAttribute("data-testid")),
	).toBe("add-workspace");
	expect(await close.getAttribute("class")).not.toContain("text-feedback-error");

	// Open a second repo so closing the current project has a deterministic next-Project-Home fallback.
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
	await secondRow.getByTestId("close-project").click();
	const confirm = page.getByTestId("confirm-popover");
	await expect(confirm).toBeVisible();
	await expect(confirm).toContainText("Close second-project?");
	await expect(confirm).toContainText(
		"Removes this project from the open projects list. Its repository, workspaces, chats, and running activity are kept. Reopen it from Add project → Recents.",
	);
	const cancel = confirm.getByRole("button", { name: "Cancel" });
	await expect(cancel).toBeFocused();
	await cancel.click();
	await expect(secondRow).toBeVisible();

	await secondRow.getByTestId("close-project").click();
	await page.getByTestId("confirm-close-project").click();
	await expect(secondRow).toHaveCount(0);
	await expect(
		observer.getByTestId("project-item").filter({ hasText: "second-project" }),
	).toHaveCount(0);
	await expect(page.getByTestId("welcome-title")).toHaveText("sample-project");
	await expect(observer.getByTestId("welcome-title")).toHaveText("sample-project");
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);

	// Close the final open project: both clients converge on the no-project Welcome.
	await page
		.getByTestId("project-item")
		.filter({ hasText: "sample-project" })
		.getByTestId("close-project")
		.click();
	await page.getByTestId("confirm-close-project").click();
	await expect(page.getByTestId("project-item")).toHaveCount(0);
	await expect(observer.getByTestId("project-item")).toHaveCount(0);
	await expect(page.getByTestId("welcome-title")).toHaveText("ThinkRail");
	await expect(observer.getByTestId("welcome-title")).toHaveText("ThinkRail");

	// Recents contains open + closed records. Reopening uses the same project id, lands at Home, and the
	// worktree created before close is still associated and listed after the rail expands.
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
