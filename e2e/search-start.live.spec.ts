import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { openFixtureProject, pressPlatformShortcut, worktreeRows } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

function persistedWorkspaces(): Workspace[] {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[];
}

test("a start from the palette's typed text creates the workspace, sends the prompt, and the agent names workspace and chat", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openFixtureProject(page);
	await expect(worktreeRows(page)).toHaveCount(0);

	await pressPlatformShortcut(page, "k");
	await expect(page.getByTestId("search-palette")).toBeVisible();
	await page
		.getByTestId("search-input")
		.fill("Add a one-line description of this project to the top of README.md.");
	await expect(page.locator('[data-testid="search-row"][data-item-id="start"]')).toBeVisible();
	await pressPlatformShortcut(page, "Enter");
	await expect(page.getByTestId("search-palette")).toBeHidden();

	await expect(worktreeRows(page)).toHaveCount(1);
	const activeRow = page.locator('[data-testid="workspace-item"][data-active="true"]');
	const initialName = (await activeRow.getByTestId("workspace-name").textContent()) ?? "";
	expect(initialName).toMatch(/^workspace-\d+$/);
	const before = persistedWorkspaces().find((w) => w.name === initialName);
	if (!before) throw new Error(`no persisted workspace named ${initialName}`);
	await expect(
		page.locator('[data-testid="chat-message"][data-role="user"]').first(),
	).toContainText("one-line description");

	const done = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });
	await expect(done).toBeVisible({ timeout: 80_000 });

	await expect
		.poll(() => persistedWorkspaces().find((w) => w.id === before.id)?.renamed === true, {
			timeout: 20_000,
		})
		.toBe(true);
	const renamed = persistedWorkspaces().find((w) => w.id === before.id);
	expect(renamed?.name.length ?? 0).toBeGreaterThan(0);
	expect(renamed?.branch ?? "").toMatch(/^[a-z0-9][a-z0-9-]*$/);
	await expect(activeRow.getByTestId("workspace-name")).toHaveText(renamed?.name ?? "", {
		timeout: 20_000,
	});
	const chatTab = page.locator('[data-testid="editor-tab"][data-kind="chat"]').first();
	await expect(chatTab).not.toHaveText(/^Chat$/, { timeout: 20_000 });
});
