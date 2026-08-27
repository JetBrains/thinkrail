import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createWorkspaceViaDialog, openFixtureProject } from "./fixtures/app";

// The TODO → review workflow's user-visible half, no agent: a seeded plan whose done steps carry
// completion summaries + real commit artifacts (the host's change-set shape) renders on the plan page
// with the separate reviewed counter; an unsettled step wears the primary Start review button ON its
// collapsed row, and a step whose review sidecar records `reviewed` (the state a settled review leaves
// behind) wears the circled Verified glyph and no affordance. There is no in-page manual verdict UI
// (the `manually` toggle + Approve/Ask-to-fix pair was removed) and no separate summary-first "Review
// mode" page (task-plan-review-kebab): findings live in the right-panel Review tab, header actions are
// a kebab menu. Actually settling a review (the reviewer chat, verdicts, ask-to-fix's fix cycle,
// Review All's queue) is @agent territory; the seeded JSON here is exactly the shape those leave behind.

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

test("reviewable steps show the reviewed counter, Start review, and the settled Verified state", async ({
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

	// Seed the state a finished agent plan leaves behind: two code steps (summary + commit artifact) — one
	// still unreviewed, one already settled via the review sidecar —, a research step (no change set →
	// never reviewable), and the plan-level completion summary.
	const shaOpen = commitFile(
		workspace.worktreePath,
		"flood.ts",
		"export const wait = 1;\n",
		"todo: implement FloodWait handling",
	);
	const shaFlagged = commitFile(
		workspace.worktreePath,
		"parse.ts",
		"export const parse = 1;\n",
		"todo: implement parser",
	);
	const shaFlaggedFix = commitFile(
		workspace.worktreePath,
		"parse.ts",
		"export const parse = 2;\n",
		"todo: fix parser edge case",
	);
	const shaDone = commitFile(
		workspace.worktreePath,
		"retry.ts",
		"export const retries = 3;\n",
		"todo: implement retry policy",
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
							artifacts: [{ kind: "commit", sha: shaOpen, label: "Implement FloodWait handling" }],
							createdAt: "2026-01-01T00:00:00Z",
							updatedAt: "2026-01-01T00:00:00Z",
						},
						{
							id: "t_reviewed",
							title: "Implement retry policy",
							status: "done",
							origin: "agent",
							summary: "Bounded retries with backoff.",
							artifacts: [{ kind: "commit", sha: shaDone, label: "Implement retry policy" }],
							createdAt: "2026-01-01T00:00:00Z",
							updatedAt: "2026-01-01T00:00:00Z",
						},
						{
							id: "t_flagged",
							title: "Implement parser",
							status: "done",
							origin: "agent",
							summary: "Recursive descent parser.",
							artifacts: [
								{ kind: "commit", sha: shaFlagged, label: "Implement parser" },
								{ kind: "commit", sha: shaFlaggedFix, label: "Fix parser edge case" },
							],
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
	// The review sidecar as settled reviews leave it: t_reviewed approved at its current sha,
	// t_flagged with a changes_requested verdict + the reviewer's note.
	writeFileSync(
		join(todosDir, `${sessionId}.reviews.json`),
		JSON.stringify({
			version: 1,
			items: {
				t_reviewed: { state: "reviewed", reviewedShas: [shaDone], at: "2026-01-01T00:00:00Z" },
				t_flagged: {
					state: "changes_requested",
					reviewedShas: [shaFlagged],
					feedback: "Handle the empty-input case.",
					at: "2026-01-01T00:00:00Z",
				},
			},
		}),
	);

	// Open the plan page through the popup.
	await page.getByTestId("chat-plan-toggle").click();
	await page.getByTestId("chat-plan-popover").getByTestId("todo-open-plan").click();
	const pane = page.getByTestId("plan-pane");
	await expect(pane).toBeVisible();

	// Plan mode: the lifecycle stepper (Build → Review → PR) and the plan-level note. Build is done,
	// review is unsettled → the PR stage stays pending.
	await expect(pane.getByTestId("plan-progress")).toContainText("4/4 done");
	await expect(pane.getByTestId("plan-review-progress")).toContainText("1/3 reviewed");
	await expect(pane.getByTestId("plan-pr-stage")).toHaveAttribute("data-state", "pending");
	// The report's context line: branch ← base and the commit count summed over revisions.
	await expect(pane.getByTestId("plan-context")).toContainText("4 commits");
	// The next-action banner picks the most urgent state — the flagged step wins over Review All —
	// and its action scrolls to that step and auto-expands it.
	const nextAction = pane.getByTestId("plan-next-action");
	await expect(nextAction).toHaveAttribute("data-kind", "fix");
	await nextAction.getByTestId("plan-next-action-go").click();
	await expect(pane.getByTestId("plan-overall-summary")).toContainText(
		"FloodWait handling shipped end to end",
	);

	// A done step collapses to title + the quiet meta strip (verification glyph, N files, short sha);
	// its prose (summary, full verification badge, change set) stays hidden until the row expands
	// (hover peeks it; a click persists it).
	const openItem = pane
		.getByTestId("plan-item")
		.filter({ hasText: "Implement FloodWait handling" });
	await expect(openItem).toHaveAttribute("data-expanded", "false");
	await expect(openItem.getByTestId("todo-verification-glyph")).toBeVisible();
	await expect(openItem.getByTestId("plan-item-summary")).not.toBeVisible();
	// The review slot renders Start review on the row (revealed on hover).
	await expect(openItem.getByTestId("plan-start-review")).toHaveCount(1);
	await openItem.getByTestId("plan-item-toggle").click();
	await expect(openItem).toHaveAttribute("data-expanded", "true");
	await expect(openItem.getByTestId("plan-item-summary")).toContainText(
		"Added throttling and fallback",
	);
	// The verification line renders as a status badge (self-reported — the title says so), not prose.
	const verification = openItem.getByTestId("todo-verification");
	await expect(verification).toContainText("bun test — 12 pass");
	await expect(verification).toHaveAttribute("data-status", "claimed");

	// The header kebab holds the export + Review All actions (portaled to the body). Review All is enabled
	// while an unsettled reviewable item exists.
	await pane.getByTestId("plan-menu").click();
	await expect(page.getByTestId("plan-copy-markdown")).toBeVisible();
	await expect(page.getByTestId("plan-save-markdown")).toBeVisible();
	await expect(page.getByTestId("plan-review-all")).not.toHaveAttribute("data-disabled", "");
	await page.keyboard.press("Escape");

	// The unsettled step: the row's review slot holds the primary Start review button (the AGENT
	// review entry point — clicking it would spawn the reviewer chat, an @agent concern); the
	// change-set disclosure carries no second one. No manual verdict UI exists beside it.
	await expect(openItem).toHaveAttribute("data-reviewed", "false");
	await openItem.getByTestId("plan-change-set-toggle").click();
	await expect(openItem.getByTestId("plan-start-review")).toHaveCount(1);
	await expect(openItem.getByTestId("plan-review-manually")).toHaveCount(0);

	// The settled step: circled Verified glyph, no review affordance anywhere on the row.
	const reviewedItem = pane.getByTestId("plan-item").filter({ hasText: "Implement retry policy" });
	await expect(reviewedItem).toHaveAttribute("data-reviewed", "true");
	await expect(reviewedItem.locator('[data-reviewed="true"][class*="remixicon"]')).toBeVisible();
	await expect(reviewedItem.getByTestId("plan-start-review")).toHaveCount(0);

	// The changes-requested step wears the warning ON the collapsed row: alert glyph + the
	// "Changes requested" chip; the reviewer's note is a detail (expand to read it).
	const flaggedItem = pane.getByTestId("plan-item").filter({ hasText: "Implement parser" });
	await expect(flaggedItem).toHaveAttribute("data-changes-requested", "true");
	await expect(flaggedItem.getByTestId("plan-item-changes-requested")).toContainText(
		"Changes requested",
	);
	// The review slot renders exactly one state — the chip displaces Start review.
	await expect(flaggedItem.getByTestId("plan-start-review")).toHaveCount(0);
	// The banner's Show step already scrolled here and auto-expanded the flagged row.
	await expect(flaggedItem).toHaveAttribute("data-expanded", "true");
	await expect(flaggedItem.getByTestId("plan-item-review-feedback")).toContainText(
		"Handle the empty-input case.",
	);
	// Two commits (a fix cycle) → the revisions mini-timeline: the reviewed sha is clean, the fix
	// commit after the verdict wears the unreviewed delta marker.
	const revisions = flaggedItem.getByTestId("plan-revision");
	await expect(revisions).toHaveCount(2);
	await expect(revisions.first()).toHaveAttribute("data-unreviewed", "false");
	await expect(revisions.last()).toHaveAttribute("data-unreviewed", "true");
	await expect(revisions.last()).toContainText("current");
	await expect(
		flaggedItem.locator('[data-changes-requested="true"][class*="remixicon"]'),
	).toBeVisible();

	// The research step never demands review.
	const researchItem = pane
		.getByTestId("plan-item")
		.filter({ hasText: "Research FloodWait semantics" });
	await expect(researchItem.getByTestId("plan-change-set")).toHaveCount(0);
});
