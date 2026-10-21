import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import type { Workspace } from "@thinkrail/contracts";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";
import { commitFile, gitAs } from "./fixtures/git";
import {
	type FakePr,
	ghMutations,
	githubOrigin,
	readGhScenario,
	remoteHead,
	writeGhScenario,
} from "./fixtures/github";

// v88 review details and actions against the GitHub seam described in e2e/SPEC.md (fake gh + github-ssh).

async function revalidate(page: Page): Promise<void> {
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

async function publishedWorkspace(page: Page, repository?: string) {
	await openFixtureProject(page);
	const workspace: Workspace = await createWorkspaceViaDialog(page);
	commitFile(workspace.worktreePath, "ship.ts", "export const ship = 1;\n", "feat: ship segment");
	const origin = githubOrigin(workspace.worktreePath, repository);
	const branch = gitAs(workspace.worktreePath, "rev-parse", "--abbrev-ref", "HEAD");
	gitAs(workspace.worktreePath, "push", "-q", "--set-upstream", "origin", branch);
	return { workspace, branch, origin };
}

function pr(branch: string, over: Partial<FakePr> = {}): FakePr {
	return { number: 128, headRefName: branch, state: "OPEN", ...over };
}

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	await testInfo.attach(name, {
		body: await page.getByTestId("topbar").screenshot({ path: testInfo.outputPath(`${name}.png`) }),
		contentType: "image/png",
	});
}

const lastUserMessage = (page: Page) =>
	page.locator('[data-testid="chat-message"][data-role="user"]').last();

test("a draft PR shows its running checks and becomes ready for review", async ({
	page,
}, testInfo) => {
	const { branch, origin } = await publishedWorkspace(page);
	try {
		writeGhScenario({
			prs: [
				pr(branch, {
					isDraft: true,
					mergeStateStatus: "DRAFT",
					statusCheckRollup: [
						{ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
						{ __typename: "CheckRun", name: "e2e", status: "IN_PROGRESS", conclusion: "" },
					],
				}),
			],
		});
		await revalidate(page);
		const chip = page.getByTestId("scope-review");
		await expect(chip).toContainText("Draft #128");
		await expect(chip).toHaveAttribute("data-state-tone", "neutral");
		await expect(page.getByTestId("scope-review-checks-glyph")).toHaveAttribute(
			"data-verdict",
			"pending",
		);
		const primary = page.getByTestId("scope-ship-review-primary");
		await expect(primary).toHaveAttribute("data-action", "ready");
		await shoot(page, testInfo, "review-draft");

		await primary.click();
		await expect.poll(ghMutations).toEqual([["pr", "ready", "128", "--repo", "acme/sample"]]);
		await expect(chip).toContainText("PR #128");
		await expect(chip).toHaveAttribute("data-state-tone", "success");
		await expect(primary).toHaveAttribute("data-action", "mergePr");
	} finally {
		origin.dispose();
	}
});

test("failing checks and requested changes read in the branch card, and Fix with agent asks the chat", async ({
	page,
}, testInfo) => {
	const { branch, origin } = await publishedWorkspace(page);
	try {
		writeGhScenario({
			prs: [
				pr(branch, {
					reviewDecision: "CHANGES_REQUESTED",
					mergeStateStatus: "BLOCKED",
					latestReviews: [{ author: { login: "anna" }, state: "CHANGES_REQUESTED" }],
					statusCheckRollup: [
						{ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
						{ __typename: "CheckRun", name: "unit", status: "COMPLETED", conclusion: "SUCCESS" },
					],
				}),
			],
		});
		await revalidate(page);
		await expect(page.getByTestId("scope-review-checks-glyph")).toHaveAttribute(
			"data-verdict",
			"failing",
		);
		const primary = page.getByTestId("scope-ship-review-primary");
		await expect(primary).toHaveAttribute("data-action", "fixChecks");
		await shoot(page, testInfo, "review-failing");

		await page.getByTestId("scope-branch-trigger").click();
		await expect(page.getByTestId("scope-review-checks")).toHaveText("1 check failing: lint");
		await expect(page.getByTestId("scope-review-decision")).toHaveText(
			"Changes requested by @anna",
		);
		await page.keyboard.press("Escape");

		await primary.click();
		await expect(lastUserMessage(page)).toContainText(
			`CI is failing on PR #128 (${branch} → main): lint.`,
		);
		expect(ghMutations()).toEqual([]);
	} finally {
		origin.dispose();
	}
});

test("Merge PR offers the allowed methods, deletes the branch on GitHub, and remembers the choice", async ({
	page,
}, testInfo) => {
	const { workspace, branch, origin } = await publishedWorkspace(page, "acme/no-rebase");
	try {
		writeGhScenario({
			repo: { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: false },
			prs: [
				pr(branch, {
					reviewDecision: "APPROVED",
					latestReviews: [{ author: { login: "anna" }, state: "APPROVED" }],
				}),
			],
		});
		await revalidate(page);
		const primary = page.getByTestId("scope-ship-review-primary");
		await expect(primary).toHaveAttribute("data-action", "mergePr");
		await primary.click();
		const dialog = page.getByTestId("merge-pr-dialog");
		await expect(dialog).toContainText(`Merge PR #128 into main?`);
		const methods = page.getByTestId("merge-pr-method").locator("[data-method]");
		await expect(methods).toHaveCount(2);
		await expect(methods.nth(0)).toHaveAttribute("data-method", "squash");
		await expect(methods.nth(0)).toHaveAttribute("aria-pressed", "true");
		await expect(page.getByTestId("merge-pr-delete-branch")).toHaveAttribute(
			"aria-checked",
			"true",
		);
		await testInfo.attach("merge-dialog", {
			body: await dialog.screenshot({ path: testInfo.outputPath("merge-dialog.png") }),
			contentType: "image/png",
		});

		await page.locator('[data-testid="merge-pr-method"] [data-method="merge"]').click();
		await page.getByTestId("merge-pr-submit").click();
		const head = gitAs(workspace.worktreePath, "rev-parse", "HEAD");
		await expect
			.poll(ghMutations)
			.toEqual([
				["pr", "merge", "128", "--repo", "acme/no-rebase", "--merge", "--match-head-commit", head],
			]);
		await expect.poll(() => remoteHead(origin.bare, branch)).toBe("");
		await expect(page.getByTestId("scope-review")).toContainText("Merged #128");
		await expect(primary).toHaveAttribute("data-action", "settle");
		expect(readGhScenario().prs[0]?.mergedWith).toBe("--merge");

		gitAs(workspace.worktreePath, "push", "-q", "--set-upstream", "origin", branch);
		writeGhScenario({ ...readGhScenario(), prs: [pr(branch, { number: 129 })] });
		await revalidate(page);
		await expect(page.getByTestId("scope-review")).toContainText("PR #129");
		await primary.click();
		await expect(
			page.locator('[data-testid="merge-pr-method"] [data-method="merge"]'),
		).toHaveAttribute("aria-pressed", "true");
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
	} finally {
		origin.dispose();
	}
});

test("a closed PR deletes its remote branch only after a confirmation, then reopens", async ({
	page,
}) => {
	const { workspace, branch, origin } = await publishedWorkspace(page);
	try {
		writeGhScenario({
			prs: [pr(branch, { state: "CLOSED", closedAt: new Date().toISOString() })],
		});
		await revalidate(page);
		await expect(page.getByTestId("scope-review")).toContainText("Closed #128");
		const menu = page.getByTestId("scope-ship-review-menu");
		const item = (action: string) =>
			page.locator(`[data-testid="scope-ship-action"][data-action="${action}"]`);
		await menu.click();
		await expect(item("reopen")).toBeVisible();
		await item("deleteRemote").click();
		const confirm = page.getByTestId("confirm-dialog");
		await expect(confirm).toContainText(`Delete origin/${branch}?`);
		await page.keyboard.press("Escape");
		expect(remoteHead(origin.bare, branch)).toBe(
			gitAs(workspace.worktreePath, "rev-parse", "HEAD"),
		);

		await menu.click();
		await item("deleteRemote").click();
		await page.getByTestId("ship-confirm-delete-remote").click();
		await expect.poll(() => remoteHead(origin.bare, branch)).toBe("");
		await expect(page.getByTestId("scope-ship-remote-primary")).toHaveAttribute(
			"data-action",
			"publish",
		);
		expect(gitAs(workspace.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);

		await menu.click();
		await expect(item("deleteRemote")).toHaveCount(0);
		await item("reopen").click();
		await expect.poll(ghMutations).toEqual([["pr", "reopen", "128", "--repo", "acme/sample"]]);
		await expect(page.getByTestId("scope-review")).toContainText("PR #128");
	} finally {
		origin.dispose();
	}
});

test("the Sync dialog hands a diverged branch to the agent to integrate", async ({ page }) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	const bare = mkdtempSync(join(tmpdir(), "thinkrail-sync-origin-"));
	const other = mkdtempSync(join(tmpdir(), "thinkrail-sync-clone-"));
	try {
		gitAs(bare, "init", "-q", "--bare");
		commitFile(workspace.worktreePath, "ship.ts", "export const ship = 1;\n", "feat: ship");
		gitAs(workspace.worktreePath, "remote", "add", "origin", bare);
		const branch = gitAs(workspace.worktreePath, "rev-parse", "--abbrev-ref", "HEAD");
		gitAs(workspace.worktreePath, "push", "-q", "--set-upstream", "origin", branch);
		gitAs(tmpdir(), "clone", "-q", "--branch", branch, bare, other);
		commitFile(other, "teammate.ts", "export const teammate = 1;\n", "feat: teammate");
		gitAs(other, "push", "-q", "origin", branch);
		commitFile(workspace.worktreePath, "mine.ts", "export const mine = 1;\n", "feat: mine");

		await revalidate(page);
		const sync = page.getByTestId("scope-ship-remote-primary");
		await expect(sync).toHaveAttribute("data-action", "sync");
		await sync.click();
		await expect(page.getByTestId("ship-sync-dialog")).toBeVisible();
		await page.getByTestId("ship-sync-agent").click();
		await expect(page.getByTestId("ship-sync-dialog")).toHaveCount(0);
		const message = lastUserMessage(page);
		await expect(message).toContainText(
			`\`origin/${branch}\` has 1 commit this checkout doesn't, and the local branch has 1 commit it doesn't`,
		);
		await expect(message).toContainText("without force-pushing");
	} finally {
		rmSync(bare, { recursive: true, force: true });
		rmSync(other, { recursive: true, force: true });
	}
});
