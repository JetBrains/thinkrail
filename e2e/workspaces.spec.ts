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
		await expect(row).not.toContainText(/\+\d+\s+−\d+/);
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
		} catch {}
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "prune"]);
	}
});

test("an attached worktree cannot also be opened as a project", async ({ page }) => {
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

		writeFileSync(E2E_PICK_DIR_POINTER, external);
		await page.getByTestId("add-project-menu").click();
		await page.getByTestId("menu-open-project").click();

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
		} catch {}
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "prune"]);
	}
});

test("creates, removes, and re-creates worktree workspaces (no branch collision)", async ({
	page,
}) => {
	await openFixtureProject(page);
	const items = worktreeRows(page);

	await createWorkspaceViaDialog(page);
	await expect(items).toHaveCount(1);
	const worktrees = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], {
		encoding: "utf8",
	});
	expect(worktrees.trim().split("\n").length).toBeGreaterThanOrEqual(2);
	expect(worktrees).toContain("/worktrees/sample-project/");

	await openWorkspaceMenu(items.first());
	await page.getByTestId("workspace-remove").click();
	await expect(page.getByRole("alertdialog", { name: /Remove .+ workspace/ })).toBeVisible();
	await page.getByTestId("confirm-remove").click();
	await expect(items).toHaveCount(0);

	await expect(page.getByTestId("welcome")).toBeVisible();
	await expect(page.getByTestId("center-tabs")).toHaveCount(0);
	await expect
		.poll(
			() =>
				execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], { encoding: "utf8" })
					.trim()
					.split("\n").length,
		)
		.toBe(1);

	await createWorkspaceViaDialog(page);
	await expect(items).toHaveCount(1);
});
