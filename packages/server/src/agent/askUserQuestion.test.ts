import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	AgentMessage,
	AskUserQuestionArgs,
	AskUserQuestionResult,
} from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import {
	ASK_ACK_TEXT,
	assessAnswerability,
	buildAnswersMessage,
	buildQuestionnaireResponse,
	createAskUserQuestionTool,
	isAckDetails,
	validateQuestionnaire,
} from "./askUserQuestion";

const args = (over: Partial<AskUserQuestionArgs> = {}): AskUserQuestionArgs => ({
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
	...over,
});

/** Concatenate the text content of a tool result (its content is a `TextContent | ImageContent` union). */
const textOf = (r: { content: { type: string; text?: string }[] }): string =>
	r.content.map((c) => c.text ?? "").join("");

/** A minimal `ExtensionContext` for the tool: only `hasUI` is read (the ack design awaits nothing). */
const ctx = (hasUI = true): ExtensionContext => ({ hasUI }) as unknown as ExtensionContext;

const run = (hasUI = true, params: AskUserQuestionArgs = args()) =>
	createAskUserQuestionTool().execute("tc-1", params as never, undefined, undefined, ctx(hasUI));

// ---- transcript fixtures for the pure assessors (structural AgentMessage views) ----

const askCall = (toolCallId: string, a: AskUserQuestionArgs = args()) =>
	({
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: "ask_user_question", arguments: a }],
	}) as unknown as AgentMessage;

const ackResult = (toolCallId: string) =>
	({
		role: "toolResult",
		toolCallId,
		toolName: "ask_user_question",
		content: [{ type: "text", text: ASK_ACK_TEXT }],
		details: { kind: "ack" },
		isError: false,
	}) as unknown as AgentMessage;

const finalResult = (toolCallId: string) =>
	({
		role: "toolResult",
		toolCallId,
		toolName: "ask_user_question",
		content: [{ type: "text", text: "User declined to answer questions" }],
		details: { answers: [], cancelled: true },
		isError: false,
	}) as unknown as AgentMessage;

const answersMessage = (toolCallId: string) =>
	({
		role: "custom",
		customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
		content: "User has answered your questions: …",
		display: true,
		details: { toolCallId, result: { answers: [], cancelled: false } },
	}) as unknown as AgentMessage;

const userMessage = (text = "actually, let me explain") =>
	({ role: "user", content: [{ type: "text", text }] }) as unknown as AgentMessage;

// ---- validation (unchanged contract) ----

test("validateQuestionnaire accepts a well-formed questionnaire", () => {
	expect(validateQuestionnaire(args()).ok).toBe(true);
});

test("the optional recommendedReason field is accepted on an option (no new validation gate)", () => {
	const withReason: AskUserQuestionArgs = {
		questions: [
			{
				question: "Which library?",
				header: "Lib",
				options: [
					{ label: "date-fns (Recommended)", description: "small", recommendedReason: "lightest" },
					{ label: "luxon", description: "rich" },
				],
			},
		],
	};
	expect(validateQuestionnaire(withReason).ok).toBe(true);
});

test("validateQuestionnaire rejects empty, too-few-options, dupes, and reserved labels", () => {
	const one = (options: { label: string; description: string }[]): AskUserQuestionArgs => ({
		questions: [{ question: "q", header: "h", options }],
	});
	expect(validateQuestionnaire({ questions: [] }).ok).toBe(false);
	expect(validateQuestionnaire(one([{ label: "only", description: "" }])).ok).toBe(false);
	expect(
		validateQuestionnaire(
			one([
				{ label: "x", description: "" },
				{ label: "x", description: "" },
			]),
		).ok,
	).toBe(false);
	expect(
		validateQuestionnaire(
			one([
				{ label: "Chat about this", description: "" },
				{ label: "ok", description: "" },
			]),
		).ok,
	).toBe(false);
});

// ---- the envelope (now the ask-user-answers message text; same wording as the blocking era) ----

test("buildQuestionnaireResponse: cancelled → the canonical decline message", () => {
	const r = buildQuestionnaireResponse({ answers: [], cancelled: true }, args());
	expect(r.content[0]?.text).toBe("User declined to answer questions");
	expect(r.details.cancelled).toBe(true);
});

test("buildQuestionnaireResponse: a partial submission lists the unanswered questions as declined", () => {
	const two: AskUserQuestionArgs = {
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
	};
	const r = buildQuestionnaireResponse(
		{
			cancelled: false,
			answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
		},
		two,
	);
	expect(r.content[0]?.text).toContain('"Which library?"="luxon"');
	expect(r.content[0]?.text).toContain('The user declined to answer: "Which runtime?".');
});

test("buildQuestionnaireResponse: an answer → the envelope with the option + note", () => {
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [
			{
				questionIndex: 0,
				question: "Which library?",
				kind: "option",
				answer: "luxon",
				notes: "for tz",
			},
		],
	};
	const r = buildQuestionnaireResponse(result, args());
	expect(r.content[0]?.text).toContain('"Which library?"="luxon"');
	expect(r.content[0]?.text).toContain("user notes: for tz");
});

test("buildQuestionnaireResponse: a multi answer's typed free text is marked as the user's own answer", () => {
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [
			{
				questionIndex: 0,
				question: "Which library?",
				kind: "multi",
				answer: "some-other-lib",
				selected: ["date-fns"],
			},
		],
	};
	const r = buildQuestionnaireResponse(result, args());
	expect(r.content[0]?.text).toContain('"Which library?"="date-fns"');
	expect(r.content[0]?.text).toContain('user\'s own answer: "some-other-lib"');
});

// ---- the ack + terminate execute ----

test("execute returns the ack immediately and ends the turn (terminate: true) — it never blocks", async () => {
	const r = await run();
	expect(textOf(r)).toBe(ASK_ACK_TEXT);
	expect(isAckDetails(r.details)).toBe(true);
	expect((r as { terminate?: boolean }).terminate).toBe(true);
});

test("execute returns the no-UI error (non-terminating) when hasUI is false", async () => {
	const r = await run(false);
	expect(textOf(r)).toContain("UI not available");
	expect((r.details as AskUserQuestionResult).cancelled).toBe(true);
	expect((r as { terminate?: boolean }).terminate).toBeUndefined();
});

test("execute returns a validation error (non-terminating) for a malformed questionnaire", async () => {
	const r = await run(true, { questions: [] });
	expect(textOf(r)).toContain("At least one question is required");
	expect((r.details as AskUserQuestionResult).cancelled).toBe(true);
	expect((r as { terminate?: boolean }).terminate).toBeUndefined();
});

// ---- assessAnswerability: the transcript-derived verdict behind session.answerQuestion ----

test("assessAnswerability: an ack'd, unanswered call is answerable and yields its args", () => {
	const verdict = assessAnswerability([askCall("tc"), ackResult("tc")], "tc");
	expect(verdict.ok).toBe(true);
	if (verdict.ok) expect(verdict.args.questions[0]?.question).toBe("Which library?");
});

test("assessAnswerability: an unknown tool call id is rejected", () => {
	expect(assessAnswerability([askCall("tc"), ackResult("tc")], "nope")).toEqual({
		ok: false,
		reason: "unknown_call",
	});
});

test("assessAnswerability: a second answer to the same call is rejected", () => {
	const messages = [askCall("tc"), ackResult("tc"), answersMessage("tc")];
	expect(assessAnswerability(messages, "tc")).toEqual({ ok: false, reason: "already_answered" });
});

test("assessAnswerability: a legacy/final tool result (not the ack) is not awaiting", () => {
	const messages = [askCall("tc"), finalResult("tc")];
	expect(assessAnswerability(messages, "tc")).toEqual({ ok: false, reason: "not_awaiting" });
});

test("assessAnswerability: a later free-form user message supersedes the questionnaire", () => {
	const messages = [askCall("tc"), ackResult("tc"), userMessage()];
	expect(assessAnswerability(messages, "tc")).toEqual({ ok: false, reason: "superseded" });
});

test("assessAnswerability: an answers message for ANOTHER call neither answers nor supersedes", () => {
	const messages = [askCall("tc"), ackResult("tc"), askCall("tc2"), answersMessage("tc2")];
	expect(assessAnswerability(messages, "tc").ok).toBe(true);
});

test("assessAnswerability: a malformed answers message cannot mark a call answered (shared guard)", () => {
	const malformed = {
		role: "custom",
		customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
		content: "tag right, shape wrong",
		display: true,
		details: { toolCallId: "tc", result: { answers: "nope" } }, // no cancelled, answers not an array
	} as unknown as AgentMessage;
	expect(assessAnswerability([askCall("tc"), ackResult("tc"), malformed], "tc").ok).toBe(true);
});

test("assessAnswerability: the tiny pre-ack window (call ended, result not yet) is answerable", () => {
	// The card unlocks at message end; `execute` (which writes the ack) runs a beat later. An answer in
	// that window must not be rejected — sendCustomMessage will steer it into the ending turn.
	expect(assessAnswerability([askCall("tc")], "tc").ok).toBe(true);
});

// ---- the ask-user-answers payload ----

test("buildAnswersMessage carries the envelope text + the correlated structured result", () => {
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	};
	const msg = buildAnswersMessage("tc-9", args(), result);
	expect(msg.customType).toBe(ASK_USER_ANSWERS_CUSTOM_TYPE);
	expect(msg.content).toContain('"Which library?"="luxon"');
	expect(msg.display).toBe(true);
	expect(msg.details).toEqual({ toolCallId: "tc-9", result });
});

test("buildAnswersMessage: a skip travels as the canonical decline", () => {
	const msg = buildAnswersMessage("tc-10", args(), { answers: [], cancelled: true });
	expect(msg.content).toBe("User declined to answer questions");
	expect(msg.details.result.cancelled).toBe(true);
});
