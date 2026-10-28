import { describe, expect, it } from "bun:test";
import type { PlanReviewResult } from "@thinkrail/contracts";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";
import { currentTranslator } from "@thinkrail/locales/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestReviewCard, readPlanReview, requestReviewSummary } from "./RequestReviewCard";

const APPROVE: PlanReviewResult = {
	itemId: "t_1",
	itemTitle: "Wire login redirect",
	verdict: "approve",
	summary: "Looks correct.",
	findings: [],
};

const CHANGES: PlanReviewResult = {
	itemId: "t_2",
	itemTitle: "Debounce search",
	verdict: "request_changes",
	summary: "Off-by-one on the last page.",
	findings: [
		{ id: "f1", kind: "inline", body: "loop bound", path: "src/a.ts", startLine: 4, endLine: 6 },
	],
};

function props(result: unknown): ToolRenderProps {
	return {
		toolCallId: "request_review-call",
		toolName: "request_review",
		args: { itemId: "t_1" },
		result,
		status: "done",
		streaming: false,
	};
}

function render(result: unknown): string {
	return renderToStaticMarkup(createElement(RequestReviewCard, props(result)));
}

describe("RequestReviewCard", () => {
	it("reads the verdict from the tool result's details, or a bare verdict", () => {
		expect(readPlanReview({ details: APPROVE })).toEqual(APPROVE);
		expect(readPlanReview(CHANGES)).toEqual(CHANGES);
		expect(readPlanReview({ details: { verdict: "maybe" } })).toBeNull();
		expect(readPlanReview(null)).toBeNull();
	});

	it("summarizes approve and request_changes verdicts", () => {
		expect(requestReviewSummary(props({ details: APPROVE }), currentTranslator())).toBe(
			"Approved “Wire login redirect”",
		);
		expect(requestReviewSummary(props({ details: CHANGES }), currentTranslator())).toBe(
			"Changes requested on “Debounce search” · 1 finding",
		);
		expect(requestReviewSummary(props(undefined), currentTranslator())).toBe("");
	});

	it("renders an approve verdict with no findings", () => {
		const html = render({ details: APPROVE });
		expect(html).toContain('data-verdict="approve"');
		expect(html).toContain("Approved");
		expect(html).toContain("Looks correct.");
		expect(html).not.toContain('data-testid="review-package-item"');
	});

	it("renders a request_changes verdict with fold-out findings", () => {
		const html = render({ details: CHANGES });
		expect(html).toContain('data-verdict="request_changes"');
		expect(html).toContain("Changes requested");
		expect(html).toContain('data-testid="review-package-item"');
		expect(html).toContain("src/a.ts L4–6");
		expect(html).toContain("loop bound");
	});

	it("shows a pending line while the review subagent is still running", () => {
		const html = renderToStaticMarkup(
			createElement(RequestReviewCard, { ...props(undefined), status: "running" }),
		);
		expect(html).toContain("Reviewing the change set");
	});

	it("shows why the review failed instead of a bare no-verdict line", () => {
		const html = renderToStaticMarkup(
			createElement(RequestReviewCard, {
				...props({
					content: [{ type: "text", text: 'TODO "t_1" has no change set to review.' }],
					details: {},
				}),
				status: "error",
			}),
		);
		expect(html).toContain('data-testid="request-review-error"');
		expect(html).toContain("has no change set to review");
		expect(html).not.toContain("No review verdict.");
	});

	it("keeps the no-verdict line when a settled result carries no text", () => {
		const html = renderToStaticMarkup(
			createElement(RequestReviewCard, { ...props({ details: {} }), status: "done" }),
		);
		expect(html).toContain("No review verdict.");
		expect(html).not.toContain('data-testid="request-review-error"');
	});
});
