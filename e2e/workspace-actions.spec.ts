import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	openFixtureProject,
	openWorkspaceMenu,
	waitTerminalReady,
	worktreeRows,
} from "./fixtures/app";
import { E2E_EDITOR_LOG } from "./fixtures/paths";

test.beforeEach(() => {
	rmSync(E2E_EDITOR_LOG, { force: true });
});

// A freshly-created workspace auto-opens a terminal, whose one-time "became visible" effect calls
// `xterm.focus()` — Radix's dropdown treats that as focus leaving the menu and dismisses it. Waiting for
// the terminal to report ready (its own settle signal) lets that effect fire *before* the menu opens,
// matching how a real user would pause between creating a workspace and reaching for its row menu.
async function settleAfterCreate(page: import("@playwright/test").Page): Promise<void> {
	await waitTerminalReady(page);
}

test("Open in launches the detected editor detached at the worktree path", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await settleAfterCreate(page);
	const row = worktreeRows(page).first();

	await openWorkspaceMenu(row);
	await page.getByTestId("workspace-open-in").click();
	// Only VS Code (the stub `code`) is asserted — whatever else the *running machine* happens to have
	// installed (a real Vim, Emacs, JetBrains IDE, …) may legitimately also appear in this list.
	const vsCode = page.getByTestId("workspace-open-in-editor").filter({ hasText: "VS Code" });
	await expect(vsCode).toBeVisible();
	await vsCode.click();

	// The stub `code` (e2e/fixtures/bin/code) appends its argv instead of launching anything real.
	await expect.poll(() => existsSync(E2E_EDITOR_LOG)).toBe(true);
	const invocation = readFileSync(E2E_EDITOR_LOG, "utf8").trim();
	expect(invocation).toContain("/worktrees/sample-project/");
});

test("Copy path copies the worktree's absolute path to the clipboard", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);
	await settleAfterCreate(page);
	const row = worktreeRows(page).first();

	await openWorkspaceMenu(row);
	await page.getByTestId("workspace-copy-path").click();
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toContain("/worktrees/sample-project/");
});

test("the Default workspace's kebab menu offers Open in / Copy path but no Remove", async ({
	page,
}) => {
	await openFixtureProject(page);
	// The Default row is pinned first — no need to create a worktree for this one.
	const row = page.locator('[data-testid="workspace-item"][data-kind="default"]');
	await openWorkspaceMenu(row);
	await expect(page.getByTestId("workspace-open-in")).toBeVisible();
	await expect(page.getByTestId("workspace-copy-path")).toBeVisible();
	await expect(page.getByTestId("workspace-remove")).toHaveCount(0);
});
