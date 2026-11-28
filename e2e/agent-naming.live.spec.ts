import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { createWorkspaceViaDialog, expandActivityStep, openWorkspaceChat } from "./fixtures/app";
import { gitQuiet, gitText } from "./fixtures/git";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";

function persistedWorkspaces(): Workspace[] {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[];
}

test("the agent names the workspace once via set_title: name, ASCII branch, lock, live push", {
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
		.fill("Add a one-line description of this project to the top of README.md.");
	await page.getByTestId("chat-send").click();

	const done = page.locator('[data-testid="turn-divider-status"][data-outcome="done"]');
	await expect(done).toBeVisible({ timeout: 80_000 });

	const isFlagged = (): boolean =>
		persistedWorkspaces().find((w) => w.id === before.id)?.renamed === true;
	await expect.poll(isFlagged, { timeout: 20_000 }).toBe(true);

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

test("the agent names a published workspace while keeping its branch and upstream", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	const workspace = await openWorkspaceChat(page);
	const remote = mkdtempSync(join(E2E_DATA_DIR, "published-naming-"));
	gitQuiet(E2E_FIXTURE_REPO, "init", "--bare", remote);
	gitQuiet(E2E_FIXTURE_REPO, "remote", "add", "origin", remote);
	try {
		gitQuiet(workspace.worktreePath, "push", "--set-upstream", "origin", workspace.branch);
		const publishedHead = gitText(remote, "rev-parse", `refs/heads/${workspace.branch}`).trim();
		await page
			.getByTestId("chat-input")
			.fill("Add a one-line description of this project to the top of README.md.");
		await page.getByTestId("chat-send").click();
		await expect(
			page.locator('[data-testid="turn-divider-status"][data-outcome="done"]'),
		).toBeVisible({ timeout: 80_000 });
		const naming = await expandActivityStep(page, "set_title");
		await expect(naming).toContainText(
			`branch ${workspace.branch} unchanged: it has an upstream or is already published`,
		);

		const named = persistedWorkspaces().find((row) => row.id === workspace.id);
		expect(named).toMatchObject({
			branch: workspace.branch,
			worktreePath: workspace.worktreePath,
			renamed: true,
		});
		expect(named?.name).not.toBe(workspace.name);
		expect(named?.branchNamePending).toBeUndefined();
		const activeRow = page.locator('[data-testid="workspace-item"][data-active="true"]');
		await expect(activeRow.getByTestId("workspace-name")).toHaveText(named?.name ?? "");
		await expect(activeRow.getByTestId("workspace-branch")).toHaveText(workspace.branch);
		expect(gitText(workspace.worktreePath, "symbolic-ref", "--short", "HEAD").trim()).toBe(
			workspace.branch,
		);
		expect(gitText(workspace.worktreePath, "rev-parse", "--abbrev-ref", "@{upstream}").trim()).toBe(
			`origin/${workspace.branch}`,
		);
		expect(gitText(remote, "rev-parse", `refs/heads/${workspace.branch}`).trim()).toBe(
			publishedHead,
		);
	} finally {
		gitQuiet(E2E_FIXTURE_REPO, "remote", "remove", "origin");
		rmSync(remote, { recursive: true, force: true });
	}
});
