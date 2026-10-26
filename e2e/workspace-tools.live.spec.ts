import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { activeWorktreeRow, expandActivityStep, openWorkspaceChat } from "./fixtures/app";
import { E2E_DATA_DIR } from "./fixtures/paths";

function persistedWorkspaces(): Workspace[] {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[];
}

test("a side-workspace request starts a real workspace whose chat runs, and status reports it", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(300_000);
	const spawner = await openWorkspaceChat(page);
	const before = new Set(persistedWorkspaces().map((workspace) => workspace.id));

	await page
		.getByTestId("chat-input")
		.fill(
			"Do this in a side workspace, not here: create a file SIDE.md whose only content is the line `side marker`. " +
				"After starting it, check that workspace's status once and tell me its chat state.",
		);
	await page.getByTestId("chat-send").click();

	const card = page.locator('[data-testid="tool-card"][data-tool="start_workspace"]').first();
	await expect(card).toHaveAttribute("data-status", "done", { timeout: 120_000 });
	await expect(card.getByTestId("tool-start-workspace")).toContainText("SIDE.md");

	await expect
		.poll(() => persistedWorkspaces().filter((workspace) => !before.has(workspace.id)).length, {
			timeout: 20_000,
		})
		.toBe(1);
	const child = persistedWorkspaces().find((workspace) => !before.has(workspace.id));
	if (!child) throw new Error("start_workspace persisted no new workspace");
	expect(child.projectId).toBe(spawner.projectId);
	expect(child.worktreePath).not.toBe(spawner.worktreePath);

	const done = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });
	await expect(done).toBeVisible({ timeout: 150_000 });
	const status = await expandActivityStep(page, "workspace_status");
	await expect(status).toContainText(child.id);

	await expect
		.poll(() => existsSync(join(child.worktreePath, "SIDE.md")), { timeout: 150_000 })
		.toBe(true);
	expect(readFileSync(join(child.worktreePath, "SIDE.md"), "utf8")).toContain("side marker");
	expect(existsSync(join(spawner.worktreePath, "SIDE.md"))).toBe(false);

	await card.getByTestId("start-workspace-open").click();
	await expect(activeWorktreeRow(page).getByTestId("workspace-name")).toHaveText(
		persistedWorkspaces().find((workspace) => workspace.id === child.id)?.name ?? child.name,
		{ timeout: 20_000 },
	);
	await expect(page.locator('[data-testid="editor-tab"][data-kind="chat"]')).toHaveCount(1);
});
