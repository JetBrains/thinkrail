import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { createWorkspaceViaDialog, openWorkspaceChat } from "./fixtures/app";
import { gitText } from "./fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";

function persistedWorkspaces(): Workspace[] {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[];
}

test("turn start names the workspace instantly, then the settled turn refines it: name, branch, live push", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page);

	const activeRow = page.locator('[data-testid="workspace-item"][data-active="true"]');
	const name = activeRow.getByTestId("workspace-name");
	const branchLine = activeRow.getByTestId("workspace-branch");
	const initialName = (await name.textContent()) ?? "";
	expect(initialName).toMatch(/^workspace-\d+$/);
	const before = persistedWorkspaces().find((w) => w.name === initialName);
	if (!before) throw new Error(`no persisted workspace named ${initialName}`);

	await page
		.getByTestId("chat-input")
		.fill("Plan how to add a login form to this project. Answer in one short sentence, no tools.");
	await page.getByTestId("chat-send").click();

	await expect(name).toHaveText("Plan How To Add A", { timeout: 20_000 });
	await expect(branchLine).toHaveText(/^plan-how-to-add-a(-\d+)?$/, { timeout: 20_000 });

	const done = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });
	await expect(done).toBeVisible({ timeout: 80_000 });

	const isFlagged = (): boolean =>
		persistedWorkspaces().find((w) => w.id === before.id)?.renamed === true;
	try {
		await expect.poll(isFlagged, { timeout: 20_000 }).toBe(true);
	} catch {
		await page.getByTestId("chat-input").fill("Thanks — reply with the single word: ok");
		await page.getByTestId("chat-send").click();
		await expect(done).toHaveCount(2, { timeout: 80_000 });
		await expect.poll(isFlagged, { timeout: 30_000 }).toBe(true);
	}

	const renamed = persistedWorkspaces().find((w) => w.id === before.id);
	const displayName = renamed?.name ?? "";
	const branch = renamed?.branch ?? "";
	expect(displayName.length).toBeGreaterThan(0);
	expect(branch).toMatch(/^[a-z0-9][a-z0-9-]*$/);
	expect(renamed?.renamed).toBe(true);
	expect(renamed?.worktreePath).toBe(before.worktreePath);
	await expect(name).toHaveText(displayName, { timeout: 20_000 });
	await expect(branchLine).toHaveText(branch, { timeout: 20_000 });

	const branches = gitText(
		E2E_FIXTURE_REPO,
		"for-each-ref",
		"--format=%(refname:short)",
		"refs/heads",
	);
	expect(branches.split("\n")).not.toContain(initialName);
	expect(branches.split("\n")).toContain(branch);
	const worktrees = gitText(E2E_FIXTURE_REPO, "worktree", "list");
	expect(worktrees).toContain(before.worktreePath);

	const second = await createWorkspaceViaDialog(page);
	expect(second.branch).toMatch(/^workspace-\d+$/);
	expect(second.branch).not.toBe(initialName);
	expect(second.worktreePath).not.toBe(before.worktreePath);
});
