import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

/** Open the fixture repo as a project via the (stubbed) directory picker; it auto-selects + expands. */
async function openFixtureProject(page: Page): Promise<void> {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").first()).toBeVisible();
}

test("creates, archives, and re-creates worktree workspaces (no branch collision)", async ({
	page,
}) => {
	await openFixtureProject(page);
	const items = page.getByTestId("workspace-item");
	const addWorkspace = page.getByTestId("add-workspace").first();

	// Create a workspace — a real git worktree appears.
	await addWorkspace.click();
	await expect(items).toHaveCount(1);
	const worktrees = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], {
		encoding: "utf8",
	});
	expect(worktrees.trim().split("\n").length).toBeGreaterThanOrEqual(2);

	// Archive it: the row goes away AND the worktree is removed from disk (back to just `main`).
	await items.first().hover();
	await items.first().getByTestId("workspace-archive").click();
	await expect(items).toHaveCount(0);
	const afterArchive = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], {
		encoding: "utf8",
	});
	expect(afterArchive.trim().split("\n").length).toBe(1);

	// Create again — must succeed despite the lingering branch (the bug was a silent no-op here).
	await addWorkspace.click();
	await expect(items).toHaveCount(1);
});
