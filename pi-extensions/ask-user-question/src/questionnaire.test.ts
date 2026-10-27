import { describe, expect, test } from "bun:test";
import type { AskUserQuestionItem } from "./core.ts";
import {
	answerSummary,
	deriveAnswer,
	deriveAnswers,
	emptyQuestionState,
	type QuestionState,
	readRecommendation,
	splitRecommended,
} from "./questionnaire.ts";

const single: AskUserQuestionItem = {
	question: "Which library?",
	header: "Lib",
	options: [
		{ label: "date-fns (Recommended)", description: "small", preview: "```ts\nformat()\n```" },
		{ label: "luxon", description: "rich" },
	],
};

const multi: AskUserQuestionItem = {
	question: "Which targets?",
	header: "Targets",
	multiSelect: true,
	options: [
		{ label: "web", description: "" },
		{ label: "cli", description: "" },
	],
};

const state = (patch: Partial<QuestionState>): QuestionState => ({
	...emptyQuestionState(),
	...patch,
});

describe("recommendation labels", () => {
	test("split the (Recommended) suffix case-insensitively", () => {
		expect(splitRecommended("date-fns (recommended) ")).toEqual({
			text: "date-fns",
			recommended: true,
		});
		expect(splitRecommended("luxon")).toEqual({ text: "luxon", recommended: false });
	});

	test("a recommended reason marks the option as recommended even without the suffix", () => {
		expect(
			readRecommendation({ label: "luxon", description: "", recommendedReason: " tz " }),
		).toEqual({
			text: "luxon",
			recommended: true,
			reason: "tz",
		});
	});
});

describe("deriveAnswer", () => {
	test("is null until something is chosen", () => {
		expect(deriveAnswer(single, 0, emptyQuestionState())).toBeNull();
		expect(deriveAnswer(multi, 0, state({ customText: "x" }))).toBeNull();
	});

	test("a single choice carries the option's preview and its note", () => {
		expect(
			deriveAnswer(
				single,
				0,
				state({ option: "date-fns (Recommended)", notes: { "date-fns (Recommended)": " tz " } }),
			),
		).toEqual({
			questionIndex: 0,
			question: "Which library?",
			kind: "option",
			answer: "date-fns (Recommended)",
			preview: "```ts\nformat()\n```",
			notes: "tz",
		});
	});

	test("an active own answer wins over the option in single-select", () => {
		expect(
			deriveAnswer(
				single,
				0,
				state({ option: "luxon", customText: " dayjs ", customActive: true }),
			),
		).toEqual({ questionIndex: 0, question: "Which library?", kind: "custom", answer: "dayjs" });
	});

	test("a multi answer keeps checked options, the included own answer and per-option notes", () => {
		expect(
			deriveAnswer(
				multi,
				1,
				state({
					multi: ["cli", "gone", "web"],
					customText: "tray",
					customActive: true,
					notes: { web: "pwa", cli: " " },
				}),
			),
		).toEqual({
			questionIndex: 1,
			question: "Which targets?",
			kind: "multi",
			answer: "tray",
			selected: ["cli", "web"],
			notes: "web: pwa",
		});
	});

	test("deriveAnswers keeps only answered questions, by index", () => {
		expect(
			deriveAnswers([single, multi], [emptyQuestionState(), state({ multi: ["web"] })]).map(
				(answer) => answer.questionIndex,
			),
		).toEqual([1]);
	});
});

describe("answerSummary", () => {
	test("reads an option without its suffix, quotes own answers, and lists multi answers", () => {
		expect(
			answerSummary({ questionIndex: 0, question: "q", kind: "option", answer: "a (Recommended)" }),
		).toBe("a");
		expect(answerSummary({ questionIndex: 0, question: "q", kind: "custom", answer: "mine" })).toBe(
			"“mine”",
		);
		expect(
			answerSummary({
				questionIndex: 0,
				question: "q",
				kind: "multi",
				answer: "mine",
				selected: ["web", "cli"],
			}),
		).toBe("web, cli, “mine”");
	});
});
