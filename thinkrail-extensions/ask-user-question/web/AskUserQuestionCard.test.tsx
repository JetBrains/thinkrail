import { describe, expect, it } from "bun:test";
import { ASK_DISCUSS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import type { ToolInteraction } from "@thinkrail/extension-api/web";
import type { AskUserQuestionItem } from "@thinkrail/pi-ask-user-question/core";
import { renderToStaticMarkup } from "react-dom/server";
import { AskUserQuestionCard } from "./AskUserQuestionCard";

const noop = () => undefined;
const interaction: ToolInteraction = {
	state: { superseded: false, ended: false, accepting: true },
	respond: async () => undefined,
	focusScope: {},
	prepareLayoutChange: () => noop,
	revealElement: noop,
	cancelAutomaticReveal: noop,
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
