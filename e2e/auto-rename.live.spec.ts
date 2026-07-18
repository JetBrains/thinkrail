import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { createWorkspaceViaDialog, openWorkspaceChat } from "./fixtures/app";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";

function persistedWorkspaces(): Workspace[] {
	return JSON.parse(readFileSync(join(E2E_DATA_DIR, "workspaces.json"), "utf8")) as Workspace[];
}

// Tagged @agent: drives a real turn AND the real assist one-shot (both need pi auth). The naive pass
// renames instantly on turn start (no model); the agentic refine fires asynchronously after the turn
// settles. Waiting for the refine in the UI is load-bearing — it also drains the hook before the next
// test's resetState() sweeps branches.
test("turn start names the workspace instantly, then the settled turn refines it: name, branch, live push", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(150_000);
	await openWorkspaceChat(page); // auto-named workspace, chat tab, composer ready

	// The chat is scoped to the ACTIVE workspace — key everything off its pre-rename record.
	const activeRow = page.locator('[data-testid="workspace-item"][data-active="true"]');
	const name = activeRow.getByTestId("workspace-name");
	// The git branch is surfaced on a second line beneath the name, shown only once they diverge.
	const branchLine = activeRow.getByTestId("workspace-branch");
	const initialName = (await name.textContent()) ?? "";
	expect(initialName).toMatch(/^workspace-\d+$/);
	const before = persistedWorkspaces().find((w) => w.name === initialName);
	if (!before) throw new Error(`no persisted workspace named ${initialName}`);

	await page
		.getByTestId("chat-input")
		.fill("Plan how to add a login form to this project. Answer in one short sentence, no tools.");
	await page.getByTestId("chat-send").click();

	// Instant naive rename the moment the first prompt lands (a user message_end, before the model
	// responds): a deterministic, non-agentic Title Case name from the first prompt ("Plan how to add a
	// login form…" → the first ~5 words), pushed live over workspace.updated — so the workspace leaves
	// `workspace-N` immediately, without waiting for the (possibly long) turn to settle.
	await expect(name).toHaveText("Plan How To Add A", { timeout: 20_000 });
	// The display name now differs from the branch, so the branch line appears with the derived kebab slug
	// (`(-\d+)?` tolerates a uniqueness suffix on the branch — never on the display name).
	await expect(branchLine).toHaveText(/^plan-how-to-add-a(-\d+)?$/, { timeout: 20_000 });

	const done = page
		.locator('[data-testid="chat-message"][data-role="system"]')
		.filter({ hasText: "Done" });
	await expect(done).toBeVisible({ timeout: 80_000 });

	// The agentic pass refines the provisional name on the settled turn (≤12s one-shot) and flags it —
	// the definitive "refine landed" signal is the persisted `renamed` flag (the refined slug can, rarely,
	// match the naive one, so don't key on the displayed text changing). A transiently-failed suggestion
	// leaves the flag unset by design; the retry trigger is the next settled turn, so drive one before
	// giving up rather than flaking on a one-off provider blip.
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

	// The persisted record moved with it: same id, a human display name DECOUPLED from a kebab branch,
	// flagged renamed, dir untouched.
	const renamed = persistedWorkspaces().find((w) => w.id === before.id);
	const displayName = renamed?.name ?? "";
	const branch = renamed?.branch ?? "";
	expect(displayName.length).toBeGreaterThan(0);
	expect(branch).toMatch(/^[a-z0-9][a-z0-9-]*$/); // branch stays a git-clean kebab slug
	expect(renamed?.renamed).toBe(true);
	expect(renamed?.worktreePath).toBe(before.worktreePath);
	// The refined name is live in the tree too (workspace.updated push, no refetch), branch on its line.
	await expect(name).toHaveText(displayName, { timeout: 20_000 });
	await expect(branchLine).toHaveText(branch, { timeout: 20_000 });

	// Git followed: the old auto-branch is gone, the new one exists — and the worktree DIR kept its name.
	const branches = execFileSync(
		"git",
		["-C", E2E_FIXTURE_REPO, "for-each-ref", "--format=%(refname:short)", "refs/heads"],
		{ encoding: "utf8" },
	);
	expect(branches.split("\n")).not.toContain(initialName);
	expect(branches.split("\n")).toContain(branch);
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
