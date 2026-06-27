import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO, E2E_PI_AGENT_DIR } from "./paths";

/**
 * Reset to a pristine slate: clear app state + any worktrees + pi's persisted sessions, and restore the
 * fixture repo to just `main`. The host reads these files per-request, so tests are isolated despite
 * sharing one host. (pi keys sessions by worktree cwd, and worktree paths repeat across tests since branches
 * are reset — so stale sessions must be cleared or they'd resurface in a later test's reused worktree.)
 */
function resetState(): void {
	rmSync(join(E2E_DATA_DIR, "projects.json"), { force: true });
	rmSync(join(E2E_DATA_DIR, "workspaces.json"), { force: true });
	rmSync(join(E2E_DATA_DIR, "worktrees"), { recursive: true, force: true });
	rmSync(join(E2E_PI_AGENT_DIR, "sessions"), { recursive: true, force: true });

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

/** The terminal layer currently shown (exactly one is `data-visible="true"` at a time). */
export function visibleTerminal(page: Page): Locator {
	return page.locator('[data-testid="terminal-instance"][data-visible="true"]');
}

/** Wait until the visible terminal's PTY is wired up (ready to receive input). */
export async function waitTerminalReady(page: Page): Promise<void> {
	await expect(visibleTerminal(page)).toHaveAttribute("data-ready", "true");
}

/** Open an additional terminal and wait until its PTY is ready. */
export async function openTerminal(page: Page): Promise<void> {
	await page.getByTestId("terminal-add").click();
	await waitTerminalReady(page);
}

/** Type a command into the visible terminal and submit it. */
export async function runInTerminal(page: Page, command: string): Promise<void> {
	await visibleTerminal(page).locator(".xterm-helper-textarea").focus();
	await page.keyboard.type(command);
	await page.keyboard.press("Enter");
}
