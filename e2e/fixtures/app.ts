import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./paths";

/**
 * Reset to a pristine slate: clear app state + any worktrees, and restore the fixture repo to just
 * `main`. The host reads these files per-request, so tests are isolated despite sharing one host.
 */
function resetState(): void {
	rmSync(join(E2E_DATA_DIR, "projects.json"), { force: true });
	rmSync(join(E2E_DATA_DIR, "workspaces.json"), { force: true });
	rmSync(join(E2E_DATA_DIR, "worktrees"), { recursive: true, force: true });

	execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "prune"]);
	const branches = execFileSync(
		"git",
		["-C", E2E_FIXTURE_REPO, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
		{ encoding: "utf8" },
	)
		.split("\n")
		.map((b) => b.trim())
		.filter((b) => b && b !== "main");
	for (const branch of branches) {
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "branch", "-D", branch], { stdio: "ignore" });
	}
}

/** Reset state, then open the fixture repo as a project via the (stubbed) picker; auto-selects + expands. */
export async function openFixtureProject(page: Page): Promise<void> {
	resetState();
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await page.getByTestId("add-project-menu").click();
	await page.getByTestId("menu-open-project").click();
	await expect(page.getByTestId("project-item").first()).toBeVisible();
}
