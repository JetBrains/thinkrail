import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

test("creates, archives, and re-creates worktree workspaces (no branch collision)", async ({
	page,
}) => {
	await openFixtureProject(page);
	const items = page.getByTestId("workspace-item");

	// Create a workspace via the New-Workspace dialog — a real git worktree appears.
	await createWorkspaceViaDialog(page);
	await expect(items).toHaveCount(1);
	const worktrees = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], {
		encoding: "utf8",
	});
	expect(worktrees.trim().split("\n").length).toBeGreaterThanOrEqual(2);
	// Worktrees live under a readable project-name dir, not the project id.
	expect(worktrees).toContain("/worktrees/sample-project/");

	// Archive it: the row goes away AND the worktree is removed from disk (back to just `main`).
	await items.first().hover();
	await items.first().getByTestId("workspace-archive").click();
	await expect(items).toHaveCount(0);
	const afterArchive = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], {
		encoding: "utf8",
	});
	expect(afterArchive.trim().split("\n").length).toBe(1);

	// Create again — must succeed despite the lingering branch (the bug was a silent no-op here).
	await createWorkspaceViaDialog(page);
	await expect(items).toHaveCount(1);
});
