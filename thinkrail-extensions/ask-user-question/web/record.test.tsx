import { describe, expect, it } from "bun:test";
import type {
	AskUserQuestionAnswer,
	AskUserQuestionItem,
} from "@thinkrail/pi-ask-user-question/core";
import { renderToStaticMarkup } from "react-dom/server";
import { AnsweredReceipt } from "./record";

const question = (n: number, multiSelect = false): AskUserQuestionItem => ({
	question: `Question ${n}?`,
	header: `Q${n}`,
	multiSelect,
	options: [
		{ label: `Pick ${n}A (Recommended)`, description: "first" },
		{ label: `Pick ${n}B`, description: "second" },
	],
});
const QUESTIONS = [question(1), question(2), question(3, true)];

const receipt = (answers: AskUserQuestionAnswer[], cancelled = false, id = "call-receipt") =>
	renderToStaticMarkup(
		<AnsweredReceipt
			toolCallId={id}
			questions={QUESTIONS}
			result={{ answers, cancelled }}
			rawText=""
			prepareLayoutChange={undefined}
		/>,
	);

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the answered receipt", () => {
	it("pairs every question with its answer, expanded by default", () => {
		const html = receipt([
			{
				questionIndex: 0,
				question: "Question 1?",
				kind: "option",
				answer: "Pick 1A (Recommended)",
				notes: "why",
			},
			{ questionIndex: 1, question: "Question 2?", kind: "custom", answer: "my own" },
			{
				questionIndex: 2,
				question: "Question 3?",
				kind: "multi",
				answer: "extra",
				selected: ["Pick 3A (Recommended)", "Pick 3B"],
			},
		]);
		const visible = text(html);
		expect(html).toContain('aria-expanded="true"');
		expect(visible).toContain("Answered 3 questions");
		expect(visible).toContain("Question 1? Options Pick 1A “why”");
		expect(visible).toContain("my own");
		expect(visible).toContain("Pick 3A, Pick 3B + extra");
		expect(html.split('data-testid="ask-receipt-pair"').length - 1).toBe(3);
		expect(html).not.toContain('data-testid="ask-record-option"');
	});

	it("counts partial answers and discussion marks in the header", () => {
		const visible = text(
			receipt([
				{ questionIndex: 0, question: "Question 1?", kind: "option", answer: "Pick 1B" },
				{
					questionIndex: 2,
					question: "Question 3?",
					kind: "discuss",
					answer: null,
					reason: "irrelevant",
					notes: "why ask?",
				},
			]),
		);
		expect(visible).toContain("Answered 1 of 3 questions");
		expect(visible).toContain("· 1 to discuss");
		expect(visible).toContain("Skipped");
		expect(visible).toContain("Let’s discuss first · Not relevant");
		expect(visible).toContain("“why ask?”");
	});

	it("reads an all-discuss round as a discussion and a skipped round as one line", () => {
		const discuss = text(
			receipt(
				QUESTIONS.map((q, i) => ({
					questionIndex: i,
					question: q.question,
					kind: "discuss" as const,
					answer: null,
				})),
			),
		);
		expect(discuss).toContain("3 questions to discuss");
		expect(discuss).not.toContain("Answered");
		const skipped = receipt([], true);
		expect(skipped).toContain('data-tone="skipped"');
		expect(text(skipped).trim()).toBe("Questions skipped");
	});
});
