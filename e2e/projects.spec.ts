import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, stagePlainFolder } from "./fixtures/app";
import { E2E_FIXTURE_REPO, E2E_PLAIN_DIR } from "./fixtures/paths";

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
	await expect(page.getByTestId("workspace-item").first()).toBeVisible();
});

test("removes a project: workspaces archived, source repo untouched, Welcome restored", async ({
	page,
}) => {
	await openFixtureProject(page);
	const projectName = basename(E2E_FIXTURE_REPO);
	const projectRow = page.getByTestId("project-item").filter({ hasText: projectName });
	await expect(projectRow).toBeVisible();

	// Create a workspace so removal has real children to archive (worktree + record).
	const created = await createWorkspaceViaDialog(page);
	await expect(page.getByTestId("workspace-item")).toHaveCount(1);
	const worktreesBefore = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], {
		encoding: "utf8",
	});
	expect(worktreesBefore.trim().split("\n").length).toBeGreaterThanOrEqual(2);

	// Kebab (…) → Remove project → destructive confirm.
	await projectRow.hover();
	await projectRow.getByTestId("project-menu").click();
	await page.getByTestId("project-remove").click();
	await expect(page.getByTestId("confirm-dialog")).toBeVisible();
	await page.getByTestId("confirm-remove-project").click();

	// Optimistic: project + workspaces gone from the rail; Welcome (no active workspace).
	await expect(projectRow).toHaveCount(0);
	await expect(page.getByTestId("workspace-item")).toHaveCount(0);
	await expect(page.getByTestId("welcome")).toBeVisible();

	// Worktree reclaim is backgrounded — poll until only the source checkout remains.
	await expect
		.poll(
			() =>
				execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], { encoding: "utf8" })
					.trim()
					.split("\n").length,
			{ timeout: 30_000 },
		)
		.toBe(1);

	// Source directory untouched: files intact, working tree clean, branches kept (including workspace branch).
	expect(existsSync(join(E2E_FIXTURE_REPO, "README.md"))).toBe(true);
	expect(existsSync(join(E2E_FIXTURE_REPO, "notes.txt"))).toBe(true);
	const status = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "status", "--porcelain"], {
		encoding: "utf8",
	});
	expect(status.trim()).toBe("");
	const branches = execFileSync(
		"git",
		["-C", E2E_FIXTURE_REPO, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
		{ encoding: "utf8" },
	);
	expect(branches).toContain("main");
	expect(branches).toContain(created.branch);
});
