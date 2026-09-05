import { expect, test } from "bun:test";
import type { ActivityStatus } from "@thinkrail/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActivityGlyph, activityBreakdown, activityChatCount } from "./ActivityGlyph";

function render(status: ActivityStatus, counts?: Partial<Record<ActivityStatus, number>>): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<ActivityGlyph status={status} counts={counts} />
		</TooltipProvider>,
	);
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
		"1 chat failed",
		"1 chat waiting for your answer",
		"2 chats working",
	]);
});

test("the breakdown omits states nothing is in", () => {
	expect(activityBreakdown({ queued: 3 })).toEqual(["3 chats queued"]);
	expect(activityBreakdown({})).toEqual([]);
});

test("several busy chats surface the breakdown as the accessible name too", () => {
	const markup = render("failed", { failed: 1, running: 2 });
	expect(markup).toContain("1 chat failed, 2 chats working");
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
