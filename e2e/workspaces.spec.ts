import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject, worktreeRows } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

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

	// Remove it: the button opens a confirmation anchored to the row; confirming fires `workspace.remove`,
	// and the row disappears when the client reacts to the host's `workspace.removed` push (event-driven, not
	// optimistic) AND the worktree is reclaimed from disk in the background (back to just `main`).
	await items.first().hover();
	await items.first().getByTestId("workspace-remove").click();
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
