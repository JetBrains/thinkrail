import { expect, test } from "bun:test";
import type { ActivityStatus } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { projectActivityRollup, workspaceActivityRollup } from "@/store";
import { ActivityGlyph, activityBreakdown, activityChatCount } from "./ActivityGlyph";

function render(status: ActivityStatus, counts?: Partial<Record<ActivityStatus, number>>): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<ActivityGlyph status={status} counts={counts} />
		</TooltipProvider>,
	);
}

function renderWorktree(sessions: Record<string, ActivityStatus>): string {
	const rollup = workspaceActivityRollup({ wa: { projectId: "p1", sessions } }, "wa");
	if (!rollup) return "";
	return render(rollup.status, rollup.counts);
}

function renderProject(worktrees: Record<string, ActivityStatus>[]): string {
	const map = Object.fromEntries(
		worktrees.map((sessions, i) => [`w${i}`, { projectId: "p1", sessions }]),
	);
	const rollup = projectActivityRollup(map, "p1");
	if (!rollup) return "";
	return render(rollup.status, rollup.counts);
}

test("every status renders a glyph carrying its own accessible name", () => {
	expect(render("running")).toContain('aria-label="Agent is working"');
	expect(render("waiting")).toContain('aria-label="Waiting for your answer"');
	expect(render("failed")).toContain('aria-label="Last run failed"');
	expect(render("queued")).toContain('aria-label="Message queued"');
});

test("the accessible name never depends on the tooltip, which hover-only surfaces cannot give a phone", () => {
	const markup = render("waiting");
	expect(markup).toContain('role="img"');
	expect(markup).toContain('data-testid="activity-glyph"');
});

test("each status uses its published semantic colour token, never a raw value", () => {
	expect(render("running")).toContain("text-feedback-info");
	expect(render("waiting")).toContain("text-feedback-warning");
	expect(render("failed")).toContain("text-feedback-error");
	expect(render("queued")).toContain("text-text-subtle");
});

test("a single busy chat keeps the plain label instead of a one-line breakdown", () => {
	expect(render("running", { running: 1 })).toContain('aria-label="Agent is working"');
});

test("the breakdown reports counts in rollup order, so the glyph's own state reads first", () => {
	expect(activityBreakdown({ running: 2, failed: 1, waiting: 1 })).toEqual([
		"1 chat waiting for your answer",
		"2 chats working",
		"1 chat failed",
	]);
});

test("the breakdown omits states nothing is in", () => {
	expect(activityBreakdown({ queued: 3 })).toEqual(["3 chats queued"]);
	expect(activityBreakdown({})).toEqual([]);
});

test("several busy chats surface the breakdown as the accessible name too", () => {
	const markup = render("running", { failed: 1, running: 2 });
	expect(markup).toContain("2 chats working, 1 chat failed");
});

test("repeated statuses still show the breakdown — the count is what the row cannot say", () => {
	const markup = render("running", { running: 2 });
	expect(markup).toContain('aria-label="2 chats working"');
	expect(markup).not.toContain('aria-label="Agent is working"');
});

test("the breakdown threshold counts CHATS, not distinct statuses", () => {
	expect(activityChatCount({ running: 2 })).toBe(2);
	expect(activityChatCount({ failed: 1, running: 3 })).toBe(4);
	expect(activityChatCount({ running: 1 })).toBe(1);
	expect(activityChatCount({})).toBe(0);
});

test("one chat keeps the plain label whichever status it is in", () => {
	expect(render("failed", { failed: 1 })).toContain('aria-label="Last run failed"');
	expect(render("queued", { queued: 1 })).toContain('aria-label="Message queued"');
});

test("a worktree with a running AND a failed chat shows the working glyph, never red — the reported regression", () => {
	const markup = renderWorktree({ s1: "failed", s2: "running" });
	expect(markup).toContain("text-feedback-info");
	expect(markup).not.toContain("text-feedback-error");
	expect(markup).toContain('aria-label="1 chat working, 1 chat failed"');
});

test("a worktree with a waiting AND a failed chat shows the waiting glyph, and names both", () => {
	const markup = renderWorktree({ s1: "failed", s2: "waiting" });
	expect(markup).toContain("text-feedback-warning");
	expect(markup).not.toContain("text-feedback-error");
	expect(markup).toContain('aria-label="1 chat waiting for your answer, 1 chat failed"');
});

test("a worktree whose only busy chat failed shows the red glyph — the fault is not hidden", () => {
	expect(renderWorktree({ s1: "failed" })).toContain('aria-label="Last run failed"');
	expect(renderWorktree({ s1: "failed" })).toContain("text-feedback-error");
});

test("a failed chat still owns the glyph over a merely-queued sibling — queued is not live work", () => {
	const markup = renderWorktree({ s1: "failed", s2: "queued" });
	expect(markup).toContain("text-feedback-error");
	expect(markup).toContain('aria-label="1 chat failed, 1 chat queued"');
});

test("a worktree with two working chats shows the working glyph with the count", () => {
	const markup = renderWorktree({ s1: "running", s2: "running" });
	expect(markup).toContain("text-feedback-info");
	expect(markup).toContain('aria-label="2 chats working"');
});

test("a quiet worktree renders no glyph at all — idle draws nothing", () => {
	expect(renderWorktree({})).toBe("");
});

test("a collapsed project with a running worktree and a failed one shows the working glyph, not red", () => {
	const markup = renderProject([{ s1: "running" }, { s2: "failed" }]);
	expect(markup).toContain("text-feedback-info");
	expect(markup).not.toContain("text-feedback-error");
	expect(markup).toContain('aria-label="1 chat working, 1 chat failed"');
});

test("a collapsed project whose only busy worktree failed shows the red glyph", () => {
	const markup = renderProject([{ s1: "failed" }]);
	expect(markup).toContain("text-feedback-error");
	expect(markup).toContain('aria-label="Last run failed"');
});

test("a project with only quiet worktrees renders no glyph", () => {
	expect(renderProject([{}, {}])).toBe("");
});

test("the breakdown lists all four states in rollup order, queued always last", () => {
	expect(activityBreakdown({ queued: 1, failed: 1, running: 1, waiting: 1 })).toEqual([
		"1 chat waiting for your answer",
		"1 chat working",
		"1 chat failed",
		"1 chat queued",
	]);
});

test("the breakdown pluralizes each state independently", () => {
	expect(activityBreakdown({ waiting: 2 })).toEqual(["2 chats waiting for your answer"]);
	expect(activityBreakdown({ waiting: 1 })).toEqual(["1 chat waiting for your answer"]);
	expect(activityBreakdown({ failed: 2 })).toEqual(["2 chats failed"]);
	expect(activityBreakdown({ queued: 1 })).toEqual(["1 chat queued"]);
});
