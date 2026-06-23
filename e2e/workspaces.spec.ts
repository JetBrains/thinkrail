import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

test("creates a git-worktree workspace under a project", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("open-project-dialog")).toBeVisible();
	await page.getByTestId("add-project-input").fill(E2E_FIXTURE_REPO);
	await page.getByTestId("add-project-submit").click();
	await expect(
		page.getByTestId("project-item").filter({ hasText: "sample-project" }),
	).toBeVisible();

	// The project auto-selects on open → create a workspace.
	await page.getByTestId("add-workspace").click();
	await expect(page.getByTestId("workspace-item")).toBeVisible();

	// A real git worktree was created (not just UI state): the repo now lists ≥ 2 worktrees.
	const worktrees = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], {
		encoding: "utf8",
	});
	expect(worktrees.trim().split("\n").length).toBeGreaterThanOrEqual(2);
});
