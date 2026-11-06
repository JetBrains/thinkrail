import { describe, expect, it } from "bun:test";
import { ASK_DISCUSS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import type { ToolInteraction } from "@thinkrail/extension-api/web";
import type { AskUserQuestionItem } from "@thinkrail/pi-ask-user-question/core";
import { renderToStaticMarkup } from "react-dom/server";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { QuestionBody } from "./QuestionBody";
import { emptyQState, type QState } from "./state";

const BOTTOM = "Bottom panel";
const single: AskUserQuestionItem = {
	question: "Where should the queue live?",
	header: "Placement",
	options: [
		{
			label: "Right panel (Recommended)",
			description: "Next to the chat.",
			recommendedReason: "Close.",
		},
		{ label: BOTTOM, description: "Shares space." },
	],
};
const multi: AskUserQuestionItem = {
	question: "Which checks?",
	header: "Checks",
	multiSelect: true,
	options: [
		{ label: "Lint", description: "Biome." },
		{ label: "Typecheck", description: "tsc." },
	],
};

const noop = () => undefined;
const interaction: ToolInteraction = {
	state: { superseded: false, ended: false, accepting: true },
	respond: async () => undefined,
	focusScope: {},
	prepareLayoutChange: () => noop,
	revealElement: noop,
	cancelAutomaticReveal: noop,
	focusComposer: noop,
	hostProtocol: ASK_DISCUSS_PROTOCOL_VERSION,
};

const state = (over: Partial<QState>): QState => ({ ...emptyQState(), ...over });

const body = (question: AskUserQuestionItem, qState: QState) =>
	renderToStaticMarkup(
		<QuestionBody
			question={question}
			state={qState}
			pageKeys
			discussAvailable
			primaryEnabled
			onFocusPrimary={() => false}
			onSelect={noop}
			onToggleMulti={noop}
			onCursor={noop}
			onCustomText={noop}
			onToggleCustom={noop}
			onReopenCustom={noop}
			onOpenNote={noop}
			onCloseNote={noop}
			onNote={noop}
			onToggleDiscuss={noop}
			onDiscussReason={noop}
			onDiscussText={noop}
			onTogglePreview={noop}
		/>,
	);

const INTERACTIVE =
	/<(?:button|input|textarea|select|a)\b[^>]*>|<[a-z]+\b[^>]*\brole="(?:button|radio|checkbox|tab|switch|menuitem)"[^>]*>/g;

function controlsWithoutTabStop(html: string): string[] {
	return [...html.matchAll(INTERACTIVE)]
		.map((m) => m[0])
		.filter((tag) => !/\btabindex="-?\d+"/.test(tag));
}

describe("every control is an explicit tab stop (WebKit skips buttons without one)", () => {
	it("covers the active card's tabs, choices, Other and footer", () => {
		const html = renderToStaticMarkup(
			<AskUserQuestionCard
				toolCallId="call-tab-stops"
				toolName="ask_user_question"
				args={{ questions: [single, multi] }}
				result={undefined}
				status="running"
				streaming={false}
				interaction={interaction}
			/>,
		);
		expect(html).toContain('data-testid="ask-skip"');
		expect(controlsWithoutTabStop(html)).toEqual([]);
	});

	it("covers the note toggle and the open note editor", () => {
		expect(controlsWithoutTabStop(body(single, state({ option: BOTTOM, cursor: 1 })))).toEqual([]);
		expect(
			controlsWithoutTabStop(body(single, state({ option: BOTTOM, cursor: 1, noteFor: BOTTOM }))),
		).toEqual([]);
	});

	it("covers the multi-select Other include toggle", () => {
		const html = body(multi, state({ multi: ["Lint"], customText: "own", customActive: true }));
		expect(html).toContain('data-testid="ask-custom-toggle"');
		expect(controlsWithoutTabStop(html)).toEqual([]);
	});

	it("covers Discuss, its reasons and text", () => {
		const html = body(single, state({ discuss: true, discussReason: "unclear" }));
		expect(html).toContain('data-testid="ask-discuss-reason"');
		expect(html).toContain('data-testid="ask-discuss-text"');
		expect(controlsWithoutTabStop(html)).toEqual([]);
	});

	it("covers the question preview fold and the option preview pane", () => {
		const long = Array.from({ length: 40 }, (_, i) => `Line ${i}`).join("\n\n");
		const html = body(
			{
				...single,
				preview: "```mermaid\nflowchart LR\n  A --> B\n```",
				options: [
					{ ...(single.options[0] ?? { label: "A", description: "" }), preview: long },
					{ label: BOTTOM, description: "Shares space." },
				],
			},
			state({ option: BOTTOM, cursor: 1 }),
		);
		expect(html).toContain('data-testid="ask-question-preview-toggle"');
		expect(html).toContain('data-testid="ask-preview-none"');
		expect(controlsWithoutTabStop(html)).toEqual([]);
	});

	it("covers the answered receipt's fold and per-question Options toggles", () => {
		const html = renderToStaticMarkup(
			<AskUserQuestionCard
				toolCallId="call-tab-stops-receipt"
				toolName="ask_user_question"
				args={{ questions: [single, multi] }}
				result={{
					details: {
						cancelled: false,
						answers: [
							{ questionIndex: 0, question: single.question, kind: "option", answer: BOTTOM },
						],
					},
				}}
				status="done"
				streaming={false}
				interaction={interaction}
			/>,
		);
		expect(html).toContain('data-testid="ask-receipt-toggle"');
		expect(html).toContain('data-testid="ask-receipt-options-toggle"');
		expect(controlsWithoutTabStop(html)).toEqual([]);
	});
});
