import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
} from "./fixtures/app";

// The plan page's finish line, no agent and no GitHub: Open PR in the header opens the compose
// dialog (pr.preview prefills title + body) and submitting runs the deterministic host-side
// pr.open. One serial journey because `git remote add` writes the SHARED repo config of the
// lane's fixture repo (worktrees share remotes): first the no-origin error toast (compose stays
// open — edits survive a failure), then origin = a LOCAL bare repo — not a forge — so the honest
// outcome is `pushed` (toast; the bare ref moves to the worktree's HEAD; compose closes on
// success), and pressing again re-pushes new commits to the SAME branch (the anti-Codex
// invariant). gh never runs here (non-GitHub remote + the THINKRAIL_GH_OFFLINE seam); the
// created/updated/compare arms are pinned by unit tests (packages/server/src/pr/pr.test.ts).

function gitIn(cwd: string, ...args: string[]): string {
	return execFileSync(
		"git",
		["-C", cwd, "-c", "user.email=e2e@thinkrail.test", "-c", "user.name=e2e", ...args],
		{ encoding: "utf8" },
	).trim();
}

test("Open PR: no origin errors, with origin pushes, re-press follows the same branch", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);

	await page.getByTestId("chat-plan-toggle").click();
	await page.getByTestId("chat-plan-popover").getByTestId("todo-open-plan").click();
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();
	const openPr = pane.getByTestId("plan-open-pr");
	await expect(openPr).toContainText("Open PR");
	const compose = page.getByTestId("open-pr-compose-dialog");
	const submit = page.getByTestId("open-pr-compose-submit");

	await openPr.click();
	await expect(compose).toBeVisible();
	await expect(page.getByTestId("open-pr-compose-title")).not.toHaveValue("");
	await submit.click();
	await expect(page.getByText("Open PR failed").first()).toBeVisible();
	await expect(page.getByText(/no 'origin' remote/i).first()).toBeVisible();
	await expect(compose).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(compose).not.toBeVisible();

	const bare = mkdtempSync(join(tmpdir(), "thinkrail-pr-origin-"));
	gitIn(bare, "init", "--bare");
	gitIn(workspace.worktreePath, "remote", "add", "origin", bare);
	writeFileSync(join(workspace.worktreePath, "flood.ts"), "export const wait = 1;\n");
	gitIn(workspace.worktreePath, "add", "--", "flood.ts");
	gitIn(workspace.worktreePath, "commit", "--no-verify", "-m", "todo: implement FloodWait");
	const firstSha = gitIn(workspace.worktreePath, "rev-parse", "HEAD");
	const branch = gitIn(workspace.worktreePath, "rev-parse", "--abbrev-ref", "HEAD");

	await openPr.click();
	await expect(compose).toBeVisible();
	await submit.click();
	await expect(page.getByText("Branch pushed").first()).toBeVisible();
	await expect(compose).not.toBeVisible();
	expect(gitIn(bare, "rev-parse", `refs/heads/${branch}`)).toBe(firstSha);

	writeFileSync(join(workspace.worktreePath, "flood.ts"), "export const wait = 2;\n");
	gitIn(workspace.worktreePath, "add", "--", "flood.ts");
	gitIn(workspace.worktreePath, "commit", "--no-verify", "-m", "todo: tune FloodWait");
	const secondSha = gitIn(workspace.worktreePath, "rev-parse", "HEAD");

	await openPr.click();
	await expect(compose).toBeVisible();
	await submit.click();
	await expect
		.poll(() => gitIn(bare, "rev-parse", `refs/heads/${branch}`), { timeout: 10_000 })
		.toBe(secondSha);
});

// The Default workspace's cwd is the project's own checkout — its branch commonly IS the repo's base
// branch (see default-workspace.spec.ts: the fixture's Default workspace sits on "main" with no base
// chip shown at all). Open PR must never push straight to that shared branch — see pr/SPEC.md.
test("Open PR is disabled in the Default workspace, whose branch is its own base branch", async ({
	page,
}) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await page.getByTestId("new-chat").first().click();
	await expect(page.getByTestId("chat-input")).toBeVisible();

	await page.getByTestId("chat-plan-toggle").click();
	await page.getByTestId("chat-plan-popover").getByTestId("todo-open-plan").click();
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();
	const openPr = pane.getByTestId("plan-open-pr");
	await expect(openPr).toBeDisabled();
	await expect(openPr).toHaveAttribute("title", /base branch/);
});
