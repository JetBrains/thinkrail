import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openAppFresh,
	openFixtureProject,
	openWorkspaceMenu,
	worktreeRows,
} from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PICK_DIR_POINTER } from "./fixtures/paths";

test("opens and safely forgets an existing user-owned worktree", async ({ page }) => {
	// Start with a persisted project whose workspace list has never been hydrated. Opening from its context
	// menu must still install the complete list before activation (Default + the attached row).
	await openAppFresh(page);
	const external = join(E2E_DATA_DIR, "existing-worktree-fixture");
	const detached = join(E2E_DATA_DIR, "detached-worktree-fixture");
	rmSync(external, { recursive: true, force: true });
	rmSync(detached, { recursive: true, force: true });
	execFileSync("git", [
		"-C",
		E2E_FIXTURE_REPO,
		"worktree",
		"add",
		external,
		"-b",
		"feature/existing",
		"main",
	]);
	execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "add", "--detach", detached, "main"]);
	writeFileSync(join(external, "staged.txt"), "preserve this staged addition\n");
	execFileSync("git", ["-C", external, "add", "staged.txt"]);
	writeFileSync(
		join(external, "README.md"),
		`${readFileSync(join(external, "README.md"), "utf8")}preserve this unstaged edit\n`,
	);
	writeFileSync(join(external, "uncommitted.txt"), "preserve this untracked file\n");

	const gitText = (cwd: string, ...args: string[]) =>
		execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
	const before = {
		status: gitText(external, "status", "--porcelain=v1", "-z"),
		branch: gitText(external, "symbolic-ref", "--short", "HEAD"),
		head: gitText(external, "rev-parse", "HEAD"),
		registry: gitText(E2E_FIXTURE_REPO, "worktree", "list", "--porcelain", "-z"),
	};
	const expectCheckoutUnchanged = () => {
		expect(gitText(external, "status", "--porcelain=v1", "-z")).toBe(before.status);
		expect(gitText(external, "symbolic-ref", "--short", "HEAD")).toBe(before.branch);
		expect(gitText(external, "rev-parse", "HEAD")).toBe(before.head);
		expect(gitText(E2E_FIXTURE_REPO, "worktree", "list", "--porcelain", "-z")).toBe(
			before.registry,
		);
	};

	writeFileSync(
		join(E2E_DATA_DIR, "projects.json"),
		JSON.stringify([
			{
				id: "fixture-project",
				name: "sample-project",
				path: E2E_FIXTURE_REPO,
				slug: "sample-project",
				lastOpened: Date.now(),
			},
		]),
	);
	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	try {
		const projectRow = page.getByTestId("project-item").filter({ hasText: "sample-project" });
		await expect(projectRow).toBeVisible();
		await projectRow.click({ button: "right" });
		await page.getByTestId("project-menu-open-existing-worktree").click();

		const dialog = page.getByTestId("existing-worktree-dialog");
		await expect(dialog).toBeVisible();
		const available = dialog
			.getByTestId("existing-worktree-candidate")
			.filter({ hasText: "feature/existing" });
		await expect(available).toContainText(external);
		await expect(available).toBeFocused();
		const detachedRow = dialog.locator(
			'[data-testid="existing-worktree-candidate"][data-status="detached"]',
		);
		await expect(detachedRow).toContainText("Detached HEAD");
		await expect(detachedRow).toContainText("Create a branch");
		await expect(detachedRow).toBeDisabled();

		await available.click();
		await expect(dialog).toHaveCount(0);
		const row = page.locator(
			'[data-testid="workspace-item"][data-kind="external"][data-active="true"]',
		);
		await expect(row).toContainText("existing-worktree-fixture");
		await expect(row).toContainText("feature/existing");
		const receipt = page.getByTestId("workspace-ready");
		await expect(receipt).toContainText("Existing worktree");
		await expect(receipt).toContainText("on feature/existing");
		expectCheckoutUnchanged();

		await openWorkspaceMenu(row);
		await expect(page.getByTestId("workspace-remove")).toHaveText("Remove from ThinkRail");
		await page.getByTestId("workspace-remove").click();
		const confirm = page.getByRole("alertdialog", {
			name: "Remove existing-worktree-fixture from ThinkRail?",
		});
		await expect(confirm).toContainText("existing checkout, files, and branch");
		await expect(confirm).toContainText("stay untouched");
		await page.getByTestId("confirm-remove").click();
		await expect(row).toHaveCount(0);

		// The ThinkRail identity is gone, but every externally-owned byte and Git registration survives.
		expect(existsSync(external)).toBe(true);
		expect(readFileSync(join(external, "uncommitted.txt"), "utf8")).toBe(
			"preserve this untracked file\n",
		);
		expectCheckoutUnchanged();
	} finally {
		for (const path of [external, detached]) {
			try {
				execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "remove", "--force", path]);
			} catch {
				rmSync(path, { recursive: true, force: true });
			}
		}
		try {
			execFileSync("git", ["-C", E2E_FIXTURE_REPO, "branch", "-D", "feature/existing"]);
		} catch {
			// The per-test reset is the final cleanup backstop if setup failed before the branch existed.
		}
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "prune"]);
	}
});

test("an attached worktree cannot also be opened as a project", async ({ page }) => {
	// pi keys chat transcripts by directory, so one folder must map to exactly one ThinkRail identity:
	// otherwise the project's Default workspace would serve the attached workspace's chats as its own and
	// purge them when either side is archived. `openExistingWorktree` guards its door; Add project guards this one.
	await openFixtureProject(page);
	const external = join(E2E_DATA_DIR, "claimed-worktree-fixture");
	rmSync(external, { recursive: true, force: true });
	execFileSync("git", [
		"-C",
		E2E_FIXTURE_REPO,
		"worktree",
		"add",
		external,
		"-b",
		"feature/claimed",
		"main",
	]);

	try {
		const projectRow = page.getByTestId("project-item").filter({ hasText: "sample-project" });
		await projectRow.click({ button: "right" });
		await page.getByTestId("project-menu-open-existing-worktree").click();
		const dialog = page.getByTestId("existing-worktree-dialog");
		await dialog
			.getByTestId("existing-worktree-candidate")
			.filter({ hasText: "feature/claimed" })
			.click();
		await expect(dialog).toHaveCount(0);
		await expect(page.locator('[data-testid="workspace-item"][data-kind="external"]')).toHaveCount(
			1,
		);

		// Point the stubbed directory picker at the checkout ThinkRail now holds as a workspace.
		writeFileSync(E2E_PICK_DIR_POINTER, external);
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();

		// Refused with a legible reason, and no second identity is created for the folder.
		const error = page.getByTestId("open-error-dialog");
		await expect(error).toBeVisible();
		await expect(error).toContainText("already open in ThinkRail as a workspace");
		await expect(page.getByTestId("project-item")).toHaveCount(1);
	} finally {
		writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
		try {
			execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "remove", "--force", external]);
		} catch {
			rmSync(external, { recursive: true, force: true });
		}
		try {
			execFileSync("git", ["-C", E2E_FIXTURE_REPO, "branch", "-D", "feature/claimed"]);
		} catch {
			// Setup may have failed before the branch existed; the per-test reset is the backstop.
		}
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "prune"]);
	}
});

test("creates, removes, and re-creates worktree workspaces (no branch collision)", async ({
	page,
}) => {
	await openFixtureProject(page);
	const items = worktreeRows(page);

	// Create a workspace via the New-Workspace dialog — a real git worktree appears.
	await createWorkspaceViaDialog(page);
	await expect(items).toHaveCount(1);
	const worktrees = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], {
		encoding: "utf8",
	});
	expect(worktrees.trim().split("\n").length).toBeGreaterThanOrEqual(2);
	// Worktrees live under a readable project-name dir, not the project id.
	expect(worktrees).toContain("/worktrees/sample-project/");

	// Remove it: the kebab menu's Remove item opens a centered confirm dialog; confirming fires
	// `workspace.remove`, and the row disappears when the client reacts to the host's `workspace.removed`
	// push (event-driven, not optimistic) AND the worktree is reclaimed from disk in the background (back
	// to just `main`).
	await openWorkspaceMenu(items.first());
	await page.getByTestId("workspace-remove").click();
	// The confirm is an accessible alertdialog named by its title (so screen readers announce it).
	await expect(page.getByRole("alertdialog", { name: /Remove .+ workspace/ })).toBeVisible();
	await page.getByTestId("confirm-remove").click();
	await expect(items).toHaveCount(0);

	// Removing the active workspace returns to the Welcome screen — not the empty IDE surface. (Regression:
	// the remove cleared the active id to "" instead of null, so the shell still rendered a dead 3-column
	// shell with "Select a workspace…" placeholders.)
	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	// The worktree teardown is backgrounded server-side, so poll rather than read once.
	await expect
		.poll(
			() =>
				execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], { encoding: "utf8" })
					.trim()
					.split("\n").length,
		)
		.toBe(1);

	// Create again — must succeed despite the lingering branch (the bug was a silent no-op here).
	await createWorkspaceViaDialog(page);
	await expect(items).toHaveCount(1);
});
