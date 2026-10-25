import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import {
	ASK_ACK_TEXT,
	ASK_CHAT_TEXT,
	ASK_STOPPED_ERROR,
	type AskUserQuestionArgs,
	type AskUserQuestionResult,
	buildQuestionnaireResponse,
	DECLINE_MESSAGE,
	isAckDetails,
	isAskUserQuestionResult,
	isolateAskUserQuestionBatch,
	MAX_HEADER_LENGTH,
	MAX_LABEL_LENGTH,
	MAX_RECOMMENDED_REASON_LENGTH,
	outcomeResult,
	validateQuestionnaire,
} from "./core.ts";
import { AskUserQuestionSchema } from "./schema.ts";

const args = (): AskUserQuestionArgs => ({
	questions: [
		{
			question: "Which library?",
			header: "Lib",
			options: [
				{ label: "date-fns", description: "small" },
				{ label: "luxon", description: "rich" },
			],
		},
	],
});

const twoQuestions = (): AskUserQuestionArgs => ({
	questions: [
		...args().questions,
		{
			question: "Which runtime?",
			header: "Runtime",
			options: [
				{ label: "bun", description: "" },
				{ label: "node", description: "" },
			],
		},
	],
});

const text = (result: { content: { text: string }[] }): string =>
	result.content.map((block) => block.text).join("");

describe("validateQuestionnaire", () => {
	test("accepts a well-formed questionnaire", () => {
		expect(validateQuestionnaire(args()).ok).toBe(true);
	});

	test("treats length limits as advice: overlong header, label and reason still validate", () => {
		const long: AskUserQuestionArgs = {
			questions: [
				{
					question: "Which stack?",
					header: "x".repeat(MAX_HEADER_LENGTH + 1),
					options: [
						{
							label: "x".repeat(MAX_LABEL_LENGTH + 1),
							description: "Long label.",
							recommendedReason: "x".repeat(MAX_RECOMMENDED_REASON_LENGTH + 1),
						},
						{ label: "Short", description: "Short label." },
					],
				},
			],
		};
		expect(Value.Check(AskUserQuestionSchema, long)).toBe(true);
		expect(validateQuestionnaire(long).ok).toBe(true);
	});

	test("has no tool-level cap on the number of questions", () => {
		const many: AskUserQuestionArgs = {
			questions: Array.from({ length: 6 }, (_, index) => ({
				question: `Question ${index + 1}?`,
				header: `Q${index + 1}`,
				options: [
					{ label: "First", description: "Use the first choice." },
					{ label: "Second", description: "Use the second choice." },
				],
			})),
		};
		expect(Value.Check(AskUserQuestionSchema, many)).toBe(true);
		expect(validateQuestionnaire(many).ok).toBe(true);
	});

	test("rejects empty, too-few-options, duplicates and reserved labels", () => {
		const one = (options: { label: string; description: string }[]): AskUserQuestionArgs => ({
			questions: [{ question: "q", header: "h", options }],
		});
		expect(validateQuestionnaire({ questions: [] }).message).toContain("At least one question");
		expect(validateQuestionnaire(one([{ label: "only", description: "" }])).ok).toBe(false);
		expect(
			validateQuestionnaire(
				one([
					{ label: "x", description: "" },
					{ label: "x", description: "" },
				]),
			).message,
		).toContain("unique within a question");
		for (const reserved of ["Other", "Type something.", "Chat about this", "Next →"]) {
			expect(
				validateQuestionnaire(
					one([
						{ label: reserved, description: "" },
						{ label: "ok", description: "" },
					]),
				).message,
			).toContain("reserved");
		}
		const duplicated = twoQuestions();
		const second = duplicated.questions[1];
		if (second) second.question = "Which library?";
		expect(validateQuestionnaire(duplicated).message).toContain("Question text must be unique");
	});
});

describe("buildQuestionnaireResponse", () => {
	test("turns Skip into the canonical decline", () => {
		const result = buildQuestionnaireResponse({ answers: [], cancelled: true }, args());
		expect(text(result)).toBe(DECLINE_MESSAGE);
		expect(result.details).toEqual({ answers: [], cancelled: true });
	});

	test("treats a submission with no answers as a decline", () => {
		const result = buildQuestionnaireResponse({ answers: [], cancelled: false }, args());
		expect(text(result)).toBe(DECLINE_MESSAGE);
		expect(result.details.cancelled).toBe(true);
	});

	test("names the unanswered questions of a partial submission as declined", () => {
		const result = buildQuestionnaireResponse(
			{
				cancelled: false,
				answers: [
					{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" },
				],
			},
			twoQuestions(),
		);
		expect(text(result)).toContain('"Which library?"="luxon"');
		expect(text(result)).toContain('The user declined to answer: "Which runtime?".');
	});

	test("carries the option, its preview and the note, and keeps the result as details", () => {
		const answered: AskUserQuestionResult = {
			cancelled: false,
			answers: [
				{
					questionIndex: 0,
					question: "Which library?",
					kind: "option",
					answer: "luxon",
					preview: "```ts\nDateTime.now()\n```",
					notes: "for tz",
				},
			],
		};
		const result = buildQuestionnaireResponse(answered, args());
		expect(text(result)).toContain('"Which library?"="luxon"');
		expect(text(result)).toContain("selected preview: ```ts");
		expect(text(result)).toContain("user notes: for tz");
		expect(result.details).toBe(answered);
	});

	test("marks a multi answer's typed text as the user's own answer", () => {
		const result = buildQuestionnaireResponse(
			{
				cancelled: false,
				answers: [
					{
						questionIndex: 0,
						question: "Which library?",
						kind: "multi",
						answer: "some-other-lib",
						selected: ["date-fns", "luxon"],
					},
				],
			},
			args(),
		);
		expect(text(result)).toContain('"Which library?"="date-fns, luxon"');
		expect(text(result)).toContain('user\'s own answer: "some-other-lib"');
	});
});

describe("outcomeResult", () => {
	test("answers become the envelope and keep running the turn", () => {
		const result = outcomeResult(
			{
				kind: "answered",
				result: {
					cancelled: false,
					answers: [
						{ questionIndex: 0, question: "Which library?", kind: "custom", answer: "dayjs" },
					],
				},
			},
			args(),
		);
		expect(text(result)).toContain('"Which library?"="dayjs"');
		expect(result.terminate).toBeUndefined();
	});

	test("a deferred answer is the canonical ack and ends the turn", () => {
		const result = outcomeResult({ kind: "deferred" }, args());
		expect(text(result)).toBe(ASK_ACK_TEXT);
		expect(isAckDetails(result.details)).toBe(true);
		expect(result.terminate).toBe(true);
	});

	test("choosing to chat is an ack with its own text", () => {
		const result = outcomeResult({ kind: "deferred", reason: "chat" }, args());
		expect(text(result)).toBe(ASK_CHAT_TEXT);
		expect(result.details).toEqual({ kind: "ack" });
		expect(result.terminate).toBe(true);
	});

	test("an abandoned question reports the stop and ends the turn", () => {
		const result = outcomeResult({ kind: "abandoned" }, args());
		expect(text(result)).toBe(ASK_STOPPED_ERROR);
		expect(result.details).toEqual({ answers: [], cancelled: true });
		expect(result.terminate).toBe(true);
	});
});

describe("isolateAskUserQuestionBatch", () => {
	test("keeps text and the first ask as the only tool call", () => {
		const message = {
			role: "assistant",
			content: [
				{ type: "text", text: "I need input." },
				{ type: "toolCall", id: "read-1", name: "read", arguments: {} },
				{ type: "toolCall", id: "ask-1", name: "ask_user_question", arguments: args() },
				{ type: "toolCall", id: "ask-2", name: "ask_user_question", arguments: args() },
				{ type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
			],
		};
		const isolated = isolateAskUserQuestionBatch(message);
		expect(isolated?.content.map((block) => ("id" in block ? block.id : block.type))).toEqual([
			"text",
			"ask-1",
		]);
	});

	test("leaves messages without an ask, or with nothing to drop, untouched", () => {
		expect(
			isolateAskUserQuestionBatch({
				role: "assistant",
				content: [{ type: "toolCall", id: "read-1", name: "read" }],
			}),
		).toBeUndefined();
		expect(
			isolateAskUserQuestionBatch({
				role: "assistant",
				content: [{ type: "toolCall", id: "ask-1", name: "ask_user_question" }],
			}),
		).toBeUndefined();
		expect(isolateAskUserQuestionBatch({ role: "user", content: "hi" })).toBeUndefined();
	});
});

describe("isAskUserQuestionResult", () => {
	test("accepts answers with a cancelled flag and rejects anything else", () => {
		expect(isAskUserQuestionResult({ answers: [], cancelled: false })).toBe(true);
		expect(isAskUserQuestionResult({ kind: "ack" })).toBe(false);
		expect(isAskUserQuestionResult({ answers: "x", cancelled: false })).toBe(false);
		expect(isAskUserQuestionResult({ answers: [] })).toBe(false);
		expect(isAskUserQuestionResult(null)).toBe(false);
	});
});
