import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRenderProps } from "../toolRegistry";
import { NextStepChips } from "./NextStepChips";

const items = [
	{ label: "Run the tests", prompt: "Run the e2e suite and report failures." },
	{ label: "Open a PR", prompt: "Open a PR for this branch." },
];

function render(overrides: Partial<ToolRenderProps> = {}): string {
	return renderToStaticMarkup(
		<NextStepChips
			toolCallId="c1"
			toolName="offer_next_steps"
			args={{ items: [{ label: "ARGUMENT LABEL", prompt: "from arguments" }] }}
			result={{ content: [{ type: "text", text: "…" }], details: { items } }}
			status="done"
			streaming={false}
			{...overrides}
		/>,
	);
}

describe("NextStepChips", () => {
	test("renders one chip per offered item, in order, from the result details", () => {
		const markup = render();
		expect(markup).toContain('data-testid="next-steps"');
		expect(markup).toContain('data-count="2"');
		expect(markup.match(/data-testid="next-step-chip"/g)).toHaveLength(2);
		expect(markup.indexOf("Run the tests")).toBeLessThan(markup.indexOf("Open a PR"));
	});

	test("never renders the tool arguments — only the validated result details", () => {
		expect(render()).not.toContain("ARGUMENT LABEL");
	});

	test("wraps within the viewport instead of scrolling sideways", () => {
		const markup = render();
		expect(markup).toContain("flex-wrap");
		expect(markup).not.toContain("overflow-x");
	});

	test("each chip is a real button with the app accent focus ring and a truncating label", () => {
		const markup = render();
		expect(markup).toContain('type="button"');
		expect(markup).toContain("focus-visible:ring-primary");
		expect(markup).toContain('<span class="truncate">Run the tests</span>');
	});

	test("renders nothing when the result carries no usable items", () => {
		expect(render({ result: { details: { items: [] } } })).toBe("");
		expect(render({ result: undefined })).toBe("");
	});

	test("a failed or still-running call falls back to the normal tool renderer", () => {
		const failed = render({
			status: "error",
			result: { content: [{ type: "text", text: "boom" }] },
		});
		expect(failed).not.toContain('data-testid="next-steps"');
		expect(failed).toContain("boom");
		expect(render({ status: "running" })).not.toContain('data-testid="next-steps"');
	});
});
