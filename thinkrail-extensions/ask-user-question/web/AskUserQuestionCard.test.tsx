import { describe, expect, it } from "bun:test";
import { ASK_DISCUSS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import type { ToolInteraction } from "@thinkrail/extension-api/web";
import type { AskUserQuestionItem } from "@thinkrail/pi-ask-user-question/core";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { dockState, forgetDockState, requestDockFocus, setDockCollapsed } from "./dockState";

const noop = () => undefined;
const interaction: ToolInteraction = {
	state: { superseded: false, ended: false, accepting: true },
	respond: async () => undefined,
	focusScope: {},
	prepareLayoutChange: () => noop,
	focusComposer: noop,
};

const question = (n: number, options: number): AskUserQuestionItem => ({
	question: `Question ${n}?`,
	header: `Q${n}`,
	options: Array.from({ length: options }, (_, i) => ({
		label: `Choice ${n}.${i}`,
		description: "fixture",
	})),
});

const render = (questions: AskUserQuestionItem[], hostProtocol?: number) =>
	renderToStaticMarkup(
		<AskUserQuestionCard
			toolCallId="call-stack"
			toolName="ask_user_question"
			args={{ questions }}
			result={undefined}
			status="running"
			streaming={false}
			interaction={{ ...interaction, hostProtocol }}
		/>,
	);

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("stacked question pages", () => {
	const html = render([question(1, 2), question(2, 4), question(3, 3)]);

	it("renders every page so the card takes the tallest one's height", () => {
		for (const n of [1, 2, 3]) expect(html).toContain(`Question ${n}?`);
		expect(count(html, "data-ask-active=")).toBe(3);
	});

	it("keeps inactive pages out of focus, the accessibility tree and test queries", () => {
		const ghosts = html.match(/<div data-ask-active="false"[^>]*>/g) ?? [];
		expect(ghosts).toHaveLength(2);
		for (const ghost of ghosts) {
			expect(ghost).toContain('aria-hidden="true"');
			expect(ghost).toContain('inert=""');
			expect(ghost).toContain("invisible");
		}
		expect(count(html, " inert=")).toBe(2);
		expect(count(html, 'data-testid="ask-question-text"')).toBe(1);
		expect(count(html, 'data-testid="ask-option"')).toBe(2);
		expect(count(html, 'data-testid="ask-custom"')).toBe(1);
		expect(count(html, 'role="tabpanel"')).toBe(1);
	});
});

describe("Discuss availability", () => {
	const questions = [question(1, 2)];

	it("withholds Discuss from a host older than the discuss protocol", () => {
		expect(render(questions, ASK_DISCUSS_PROTOCOL_VERSION - 1)).not.toContain(
			'data-testid="ask-discuss"',
		);
		expect(render(questions)).not.toContain('data-testid="ask-discuss"');
	});

	it("offers Discuss to a host at the discuss protocol", () => {
		expect(render(questions, ASK_DISCUSS_PROTOCOL_VERSION)).toContain('data-testid="ask-discuss"');
	});
});

describe("placements", () => {
	const questions = [question(1, 2), question(2, 2)];
	const renderAt = (
		placement: ToolInteraction["placement"],
		toolCallId = "call-placement",
		result: unknown = undefined,
	) =>
		renderToStaticMarkup(
			<TooltipProvider>
				<AskUserQuestionCard
					toolCallId={toolCallId}
					toolName="ask_user_question"
					args={{ questions }}
					result={result}
					status={result === undefined ? "running" : "done"}
					streaming={false}
					interaction={{ ...interaction, placement }}
				/>
			</TooltipProvider>,
		);

	it("renders the transcript stub, not the questionnaire, while the live copy is docked", () => {
		const html = renderAt("stub");
		expect(html).toContain('data-tone="docked"');
		expect(html).toContain('data-testid="ask-docked-open"');
		expect(html).toContain("2 questions");
		expect(html).not.toContain('data-testid="ask-question-text"');
	});

	it("renders the docked sheet with pinned header and footer around a scrolling body", () => {
		const html = renderAt("dock");
		expect(html).toContain('data-placement="dock"');
		expect(html).toContain('data-collapsed="false"');
		expect(html).toContain('role="tablist"');
		expect(html).toContain('data-testid="ask-collapse"');
		expect(html).toMatch(/data-testid="ask-dock-body" class="[^"]*overflow-y-auto/);
		expect(html).toContain('data-testid="ask-continue"');
		expect(html).not.toContain("rounded-lg");
	});

	it("keeps only the header row when collapsed, and a focus request expands it", () => {
		setDockCollapsed("call-collapsed", true);
		const collapsed = renderAt("dock", "call-collapsed");
		expect(collapsed).toContain('data-collapsed="true"');
		expect(collapsed).toContain('aria-expanded="false"');
		expect(collapsed).toMatch(/data-testid="ask-dock-body" class="[^"]*\bhidden\b/);
		expect(count(collapsed, 'data-testid="ask-tab"')).toBe(2);

		requestDockFocus("call-collapsed");
		expect(dockState("call-collapsed")).toEqual({ collapsed: false, focusRequest: 1 });
		expect(renderAt("dock", "call-collapsed")).toContain('data-collapsed="false"');
		forgetDockState("call-collapsed");
	});

	it("keeps the inline card outside the chat dock and renders nothing docked once answered", () => {
		const inline = renderAt(undefined);
		expect(inline).not.toContain("data-placement");
		expect(inline).toContain("rounded-lg");
		const answered = { details: { answers: [], cancelled: true } };
		expect(renderAt("dock", "call-answered", answered)).toBe("");
	});
});
