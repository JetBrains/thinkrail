import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Workspace } from "@thinkrail-pi/contracts";
import { createWorkspaceViaDialog, openWorkspaceChat } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";

function persistedWorkspaces(): Workspace[] {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[];
}

// Tagged @agent: drives a real turn AND the real assist one-shot (both need pi auth). The rename fires
// asynchronously after the turn settles; waiting for it in the UI is load-bearing — it also drains the
// hook before the next test's resetState() sweeps branches.
test("first settled turn auto-renames the workspace: name, branch, live push", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page); // auto-named workspace, chat tab, composer ready

	// The chat is scoped to the ACTIVE workspace — key everything off its pre-rename record.
	const name = page
		.locator('[data-testid="workspace-item"][data-active="true"]')
		.getByTestId("workspace-name");
	const initialName = (await name.textContent()) ?? "";
	expect(initialName).toMatch(/^workspace-\d+$/);
	const before = persistedWorkspaces().find((w) => w.name === initialName);
	if (!before) throw new Error(`no persisted workspace named ${initialName}`);

	await page
		.getByTestId("chat-input")
		.fill("Plan how to add a login form to this project. Answer in one short sentence, no tools.");
	await page.getByTestId("chat-send").click();
	const done = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });
	await expect(done).toBeVisible({ timeout: 80_000 });

	// The workspace.updated push lands after the one-shot (≤12s) — the tree renames live, no refetch.
	// A transiently-failed suggestion leaves the flag unset by design; the retry trigger is the next
	// settled turn, so drive one before giving up rather than flaking on a one-off provider blip.
	try {
		await expect(name).not.toHaveText(initialName, { timeout: 20_000 });
	} catch {
		await page.getByTestId("chat-input").fill("Thanks — reply with the single word: ok");
		await page.getByTestId("chat-send").click();
		await expect(done).toHaveCount(2, { timeout: 80_000 });
		await expect(name).not.toHaveText(initialName, { timeout: 30_000 });
	}
	const slug = (await name.textContent()) ?? "";
	expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*$/);

	// The persisted record moved with it: same id, name === branch, flagged renamed, dir untouched.
	const renamed = persistedWorkspaces().find((w) => w.id === before.id);
	expect(renamed?.name).toBe(slug);
	expect(renamed?.branch).toBe(slug);
	expect(renamed?.renamed).toBe(true);
	expect(renamed?.worktreePath).toBe(before.worktreePath);

	// Git followed: the old auto-branch is gone, the new one exists — and the worktree DIR kept its name.
	const branches = execFileSync(
		"git",
		["-C", E2E_FIXTURE_REPO, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
		{ encoding: "utf8" },
	);
	expect(branches.split("\n")).not.toContain(initialName);
	expect(branches.split("\n")).toContain(slug);
	const worktrees = execFileSync("git", ["-C", E2E_FIXTURE_REPO, "worktree", "list"], {
		encoding: "utf8",
	});
	expect(worktrees).toContain(before.worktreePath);

	// Freed-name regression: the old auto-name is a free branch again but its dir is occupied — the
	// next auto-create must skip it, not fail in `git worktree add`.
	const second = await createWorkspaceViaDialog(page);
	expect(second.branch).toMatch(/^workspace-\d+$/);
	expect(second.branch).not.toBe(initialName);
	expect(second.worktreePath).not.toBe(before.worktreePath);
});
