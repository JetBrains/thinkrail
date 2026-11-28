import { expect, test } from "@playwright/test";
import { openWorkspaceChat, waitForAgentSettled } from "./fixtures/app";
import { commitFile, gitAs } from "./fixtures/git";
import { ghMutations, githubOrigin, readGhScenario, writeGhScenario } from "./fixtures/github";

test("a PR merged by the agent reaches the topbar at settlement without window focus", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(240_000);
	const workspace = await openWorkspaceChat(page);
	const branch = "feature/review-refresh";
	gitAs(workspace.worktreePath, "switch", "-c", branch);
	commitFile(workspace.worktreePath, "review.txt", "review refresh\n", "test: review refresh");
	const origin = githubOrigin(workspace.worktreePath);
	try {
		gitAs(workspace.worktreePath, "push", "-q", "--set-upstream", "origin", branch);
		writeGhScenario({ prs: [{ number: 128, headRefName: branch, state: "OPEN" }] });
		await expect(page.getByTestId("scope-branch")).toHaveText(branch);
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		await expect(page.getByTestId("scope-review")).toContainText("PR #128");

		await page
			.getByTestId("chat-input")
			.fill(
				"Run exactly this command with the bash tool: gh pr merge 128 --squash. Do not edit files or run other commands. Then reply MERGE_DONE.",
			);
		await page.getByTestId("chat-send").click();
		await waitForAgentSettled(page, 210_000);

		expect(ghMutations()).toEqual([["pr", "merge", "128", "--squash"]]);
		expect(readGhScenario().prs[0]?.state).toBe("MERGED");
		await expect(page.getByTestId("scope-review")).toContainText("Merged #128", {
			timeout: 15_000,
		});
	} finally {
		origin.dispose();
	}
});
