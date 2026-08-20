import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// The TODO → review workflow's user-driven half, no agent: a seeded plan whose done step carries a
// completion summary + a real commit artifact (the host's change-set shape) renders on the plan page
// with the separate reviewed counter, and the inline manual Approve (next to the changes) records the
// review (host sidecar) and flips the counter + the step's Verified glyph. There is no separate
// summary-first "Review mode" page any more (task-plan-review-kebab): findings live in the right-panel
// Review tab, header actions are a kebab menu. The agent half (the host committing per done item,
// ask-to-fix's fix cycle, Review All) is @agent territory; the seeded JSON here is exactly the shape
// those leave behind.

/** One real commit in the worktree (the shape artifacts.ts leaves), returning its sha. */
function commitFile(worktree: string, path: string, content: string, subject: string): string {
	writeFileSync(join(worktree, path), content);
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			["-C", worktree, "-c", "user.email=e2e@thinkrail.test", "-c", "user.name=e2e", ...args],
			{ encoding: "utf8" },
		);
	git("add", "--", path);
	git("commit", "--no-verify", "-m", subject);
	return git("rev-parse", "HEAD").trim();
}

test("a reviewable step shows the reviewed counter and inline Approve records the review", async ({
	page,
}) => {
	await openFixtureProject(page);
	const workspace = await createWorkspaceViaDialog(page);
	// The open chat's session id — the key its on-disk plan is seeded under.
	const sessionId = await page
		.locator('[data-testid="editor-tab"][data-kind="chat"]')
		.first()
		.getAttribute("data-session-id");
	if (!sessionId) throw new Error("chat tab exposes no session id");

	// Seed the state a finished agent plan leaves behind: a code step (summary + commit artifact), a
	// research step (no change set → never reviewable), and the plan-level completion summary.
	const sha = commitFile(
		workspace.worktreePath,
		"flood.ts",
		"export const wait = 1;\n",
		"todo: implement FloodWait handling",
	);
	const todosDir = join(workspace.worktreePath, ".thinkrail", "context", "todos");
	mkdirSync(todosDir, { recursive: true });
	writeFileSync(
		join(todosDir, `${sessionId}.json`),
		JSON.stringify({
			version: 5,
			todos: [],
			summary: "FloodWait handling shipped end to end; suite green.",
			groups: [
				{
					id: "g_1",
					title: "Ship FloodWait handling",
					todos: [
						{
							id: "t_code",
							title: "Implement FloodWait handling",
							status: "done",
							origin: "agent",
							summary: "Added throttling and fallback for failed batch sends.",
							verification: "bun test — 12 pass",
							artifacts: [{ kind: "commit", sha, label: "Implement FloodWait handling" }],
							createdAt: "2026-01-01T00:00:00Z",
							updatedAt: "2026-01-01T00:00:00Z",
						},
						{
							id: "t_research",
							title: "Research FloodWait semantics",
							status: "done",
							origin: "agent",
							createdAt: "2026-01-01T00:00:00Z",
							updatedAt: "2026-01-01T00:00:00Z",
						},
					],
				},
			],
		}),
	);

	// Open the plan page through the popup.
	await page.getByTestId("chat-plan-toggle").click();
	await page.getByTestId("chat-plan-popover").getByTestId("todo-open-plan").click();
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();

	// Plan mode: dual counters (execution vs review), the plan-level note, the step's summary above its
	// change set, and no review demand on the research step.
	await expect(pane.getByTestId("plan-progress")).toContainText("2/2 done");
	await expect(pane.getByTestId("plan-review-progress")).toContainText("0/1 reviewed");
	await expect(pane.getByTestId("plan-overall-summary")).toContainText(
		"FloodWait handling shipped end to end",
	);
	await expect(pane.getByTestId("plan-item-summary")).toContainText(
		"Added throttling and fallback",
	);
	// The verification line renders as a status badge (self-reported — the title says so), not prose.
	const verification = pane.getByTestId("todo-verification").first();
	await expect(verification).toContainText("bun test — 12 pass");
	await expect(verification).toHaveAttribute("data-status", "claimed");

	// The header kebab holds the export + Review All actions (portaled to the body). Review All is enabled
	// while an unsettled reviewable item exists.
	await pane.getByTestId("plan-menu").click();
	await expect(page.getByTestId("plan-copy-markdown")).toBeVisible();
	await expect(page.getByTestId("plan-save-markdown")).toBeVisible();
	await expect(page.getByTestId("plan-review-all")).not.toHaveAttribute("data-disabled", "");
	await page.keyboard.press("Escape");

	// Approve happens NEXT TO THE CHANGES: expanding the step's change set reveals a Start review button,
	// which unfolds the verdict pair right under the file rows.
	const codeItem = pane
		.getByTestId("plan-item")
		.filter({ hasText: "Implement FloodWait handling" });
	await expect(codeItem).toHaveAttribute("data-reviewed", "false");
	await codeItem.getByTestId("plan-change-set-toggle").click();
	// The AGENT review entry point is there (clicking it would spawn the reviewer chat — an @agent
	// concern); this no-agent spec drives the MANUAL override sitting right beside it.
	await expect(codeItem.getByTestId("plan-start-review")).toBeVisible();
	await codeItem.getByTestId("plan-review-manually").click();
	await codeItem.getByTestId("review-approve").click();

	// Approved → the step's glyph becomes the circled Verified check, the counter flips, and the inline
	// affordance disappears.
	await expect(codeItem).toHaveAttribute("data-reviewed", "true");
	await expect(codeItem.locator('[data-reviewed="true"][class*="lucide"]')).toBeVisible();
	await expect(codeItem.getByTestId("plan-start-review")).toHaveCount(0);
	await expect(pane.getByTestId("plan-review-progress")).toContainText("1/1 reviewed");
	// Nothing left unsettled → Review All is disabled in the kebab.
	await pane.getByTestId("plan-menu").click();
	await expect(page.getByTestId("plan-review-all")).toHaveAttribute("data-disabled", "");
	await page.keyboard.press("Escape");
	const sidecar = join(todosDir, `${sessionId}.reviews.json`);
	expect(existsSync(sidecar)).toBe(true);
	const record = JSON.parse(readFileSync(sidecar, "utf8")).items.t_code;
	expect(record.state).toBe("reviewed");
	expect(record.reviewedShas).toEqual([sha]);
});
