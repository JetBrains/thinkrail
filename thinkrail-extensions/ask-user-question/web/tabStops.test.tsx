import { describe, expect, it } from "bun:test";
import { ASK_DISCUSS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import type { ToolInteraction } from "@thinkrail/extension-api/web";
import type { AskUserQuestionItem } from "@thinkrail/pi-ask-user-question/core";
import { localKeys } from "@thinkrail/ui/local-keys";
import { TooltipProvider } from "@thinkrail/ui/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { AskUserQuestionCard } from "./AskUserQuestionCard";
import { CARD_COMMANDS, CARD_SCOPE } from "./keys";
import { FrameReturn } from "./previews";
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
	focusComposer: noop,
	focusTranscript: noop,
	mayClaimFocus: () => true,
	landingChord: "F6",
	hostProtocol: ASK_DISCUSS_PROTOCOL_VERSION,
};

const state = (over: Partial<QState>): QState => ({ ...emptyQState(), ...over });

const body = (question: AskUserQuestionItem, qState: QState) =>
	renderToStaticMarkup(
		<TooltipProvider>
			<QuestionBody
				question={question}
				state={qState}
				keys={localKeys(null, CARD_SCOPE, CARD_COMMANDS)}
				pageKeys
				discussAvailable
				primaryEnabled
				claimFocus
				onFocusFoot={() => false}
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
			/>
		</TooltipProvider>,
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

	it("covers the docked sheet's collapse toggle and the transcript stub", () => {
		const docked = (placement: "dock" | "stub") =>
			renderToStaticMarkup(
				<TooltipProvider>
					<AskUserQuestionCard
						toolCallId={`call-tab-stops-${placement}`}
						toolName="ask_user_question"
						args={{ questions: [single, multi] }}
						result={undefined}
						status="running"
						streaming={false}
						interaction={{ ...interaction, placement }}
					/>
				</TooltipProvider>,
			);
		const sheet = docked("dock");
		expect(sheet).toContain('data-testid="ask-collapse"');
		expect(controlsWithoutTabStop(sheet)).toEqual([]);
		const stub = docked("stub");
		expect(stub).toContain('data-testid="ask-docked-open"');
		expect(controlsWithoutTabStop(stub)).toEqual([]);
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
		expect(html).toContain('data-testid="ask-compare-open"');
		expect(controlsWithoutTabStop(html)).toEqual([]);
	});

	it("covers the HTML preview's way back: a trailing return stop in the Tab order", () => {
		const html = renderToStaticMarkup(<FrameReturn onReturn={noop} />);
		expect(html).toContain('data-testid="ask-preview-return"');
		expect(html).toContain('tabindex="0"');
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

	it("covers the receipt's Compare entry on a question with option previews", () => {
		const previewed: AskUserQuestionItem = {
			...single,
			options: single.options.map((option) => ({ ...option, preview: `# ${option.label}` })),
		};
		const html = renderToStaticMarkup(
			<AskUserQuestionCard
				toolCallId="call-tab-stops-receipt-compare"
				toolName="ask_user_question"
				args={{ questions: [previewed] }}
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
		expect(html).toContain('data-testid="ask-receipt-compare"');
		expect(controlsWithoutTabStop(html)).toEqual([]);
	});
});
