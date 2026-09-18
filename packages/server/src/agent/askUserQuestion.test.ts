import { expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	AgentMessage,
	AskUserQuestionArgs,
	AskUserQuestionResult,
} from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import { Value } from "typebox/value";
import {
	ASK_ACK_TEXT,
	ASK_STOPPED_ERROR,
	AskUserQuestionSchema,
	assessAnswerability,
	awaitingQuestionToolCallId,
	buildAnswersMessage,
	buildQuestionnaireResponse,
	createAskUserQuestionTool,
	createAskUserQuestionWaiters,
	hasQuestionAck,
	isolateAskUserQuestionBatch,
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

const textOf = (r: { content: { type: string; text?: string }[] }): string =>
	r.content.map((c) => c.text ?? "").join("");

const ctx = (hasUI = true): ExtensionContext => ({ hasUI }) as unknown as ExtensionContext;

const run = (hasUI = true, params: AskUserQuestionArgs = args()) =>
	createAskUserQuestionTool(createAskUserQuestionWaiters()).execute(
		"tc-1",
		params as never,
		undefined,
		undefined,
		ctx(hasUI),
	);

const askCall = (
	toolCallId: string,
	a: AskUserQuestionArgs = args(),
	stopReason: string = "toolUse",
) =>
	({
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: "ask_user_question", arguments: a }],
		stopReason,
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

const persistedAnswer = (
	toolCallId: string,
	details: AskUserQuestionResult,
	questions: AskUserQuestionArgs = args(),
) => ({
	toolCallId,
	toolName: "ask_user_question",
	...buildQuestionnaireResponse(details, questions),
	isError: false,
});

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

test("validateQuestionnaire accepts a well-formed questionnaire", () => {
	expect(validateQuestionnaire(args()).ok).toBe(true);
});

test("the schema and runtime validation accept more than four questions", async () => {
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

	const waiters = createAskUserQuestionWaiters();
	const pending = createAskUserQuestionTool(waiters).execute(
		"tc-many",
		many,
		undefined,
		undefined,
		ctx(),
	);
	await Promise.resolve();
	const answered = waiters.answer("tc-many", { answers: [], cancelled: true });
	expect(answered.handled).toBe(true);
	expect(textOf(await pending)).toContain("declined");
	waiters.persistTurn([persistedAnswer("tc-many", { answers: [], cancelled: true }, many)]);
	if (answered.handled) await answered.persisted;
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

test("an ask call becomes the only tool in its assistant batch", () => {
	const message = {
		role: "assistant",
		content: [
			{ type: "text", text: "I need input." },
			{ type: "toolCall", id: "read-1", name: "read", arguments: {} },
			{ type: "toolCall", id: "ask-1", name: "ask_user_question", arguments: args() },
			{ type: "toolCall", id: "ask-2", name: "ask_user_question", arguments: args() },
			{ type: "toolCall", id: "bash-1", name: "bash", arguments: {} },
		],
	} as unknown as AgentMessage;
	const isolated = isolateAskUserQuestionBatch(message);
	expect(isolated?.role).toBe("assistant");
	if (isolated?.role !== "assistant") throw new Error("assistant batch was not isolated");
	expect(
		isolated.content.filter((block) => block.type === "toolCall").map((block) => block.id),
	).toEqual(["ask-1"]);
});

test("a valid live execution is sequential, blocks for its answer, and returns the real result", async () => {
	const waiters = createAskUserQuestionWaiters();
	const tool = createAskUserQuestionTool(waiters);
	expect(tool.executionMode).toBe("sequential");
	let settled = false;
	const pending = tool
		.execute("tc-1", args() as never, undefined, undefined, ctx())
		.then((result) => {
			settled = true;
			return result;
		});
	await Promise.resolve();
	expect(settled).toBe(false);
	expect(waiters.isWaitingForAnswer()).toBe(true);
	expect(waiters.hasRecoverableCall()).toBe(true);

	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	};
	const answered = waiters.answer("tc-1", result);
	expect(answered.handled).toBe(true);
	expect(waiters.isWaitingForAnswer()).toBe(false);
	expect(waiters.hasRecoverableCall()).toBe(true);
	const response = await pending;
	expect(textOf(response)).toContain('"Which library?"="luxon"');
	expect(response.details).toEqual(result);
	expect((response as { terminate?: boolean }).terminate).toBeUndefined();
	waiters.persistTurn([persistedAnswer("tc-1", result)]);
	if (answered.handled) await answered.persisted;
	expect(waiters.hasRecoverableCall()).toBe(false);
});

test("an answer arriving after tool_execution_start but before execute is retained", async () => {
	const waiters = createAskUserQuestionWaiters();
	waiters.expect("tc-early");
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	};
	const answered = waiters.answer("tc-early", result);
	expect(answered.handled).toBe(true);
	const response = await createAskUserQuestionTool(waiters).execute(
		"tc-early",
		args() as never,
		undefined,
		undefined,
		ctx(),
	);
	expect(response.details).toEqual(result);
	waiters.persistTurn([persistedAnswer("tc-early", result)]);
	if (answered.handled) await answered.persisted;
});

test("an early answer wins even if Stop reaches the tool before execute starts", async () => {
	const waiters = createAskUserQuestionWaiters();
	const controller = new AbortController();
	waiters.expect("tc-early-stop");
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	};
	const answered = waiters.answer("tc-early-stop", result);
	controller.abort();
	const response = await createAskUserQuestionTool(waiters).execute(
		"tc-early-stop",
		args() as never,
		controller.signal,
		undefined,
		ctx(),
	);
	expect(response.details).toEqual(result);
	waiters.persistTurn([persistedAnswer("tc-early-stop", result)]);
	if (answered.handled) await answered.persisted;
});

test("shutdown freezes an expected call before a late answer can race its snapshot", () => {
	const waiters = createAskUserQuestionWaiters();
	waiters.expect("tc-shutdown-expected");
	expect(waiters.prepareShutdown()).toBeNull();
	expect(waiters.hasRecoverableCall()).toBe(true);
	expect(() => waiters.answer("tc-shutdown-expected", { answers: [], cancelled: true })).toThrow(
		"not awaiting an answer",
	);
	expect(() => waiters.answer("restart-repaired", { answers: [], cancelled: true })).toThrow(
		"not awaiting an answer",
	);
	waiters.abandon();
});

test("shutdown waits for an answer already accepted before its snapshot", async () => {
	const waiters = createAskUserQuestionWaiters();
	const pending = createAskUserQuestionTool(waiters).execute(
		"tc-shutdown-accepted",
		args() as never,
		undefined,
		undefined,
		ctx(),
	);
	await Promise.resolve();
	const answered = waiters.answer("tc-shutdown-accepted", { answers: [], cancelled: true });
	expect(answered.handled).toBe(true);
	await pending;
	const settling = waiters.prepareShutdown();
	expect(settling).not.toBeNull();
	waiters.persistTurn([persistedAnswer("tc-shutdown-accepted", { answers: [], cancelled: true })]);
	await settling;
});

test("explicit Stop claims an expected call before execute or a late answer can win", async () => {
	const waiters = createAskUserQuestionWaiters();
	waiters.expect("tc-stop-expected");
	expect(waiters.prepareAbort()).toBeNull();
	expect(waiters.isWaitingForAnswer()).toBe(false);
	expect(waiters.hasRecoverableCall()).toBe(false);
	await expect(waiters.wait("tc-stop-expected", undefined)).rejects.toThrow(ASK_STOPPED_ERROR);
	expect(() => waiters.answer("tc-stop-expected", { answers: [], cancelled: true })).toThrow(
		"not awaiting an answer",
	);
	waiters.persistTurn([]);
});

test("semantic validation failure cannot acknowledge an answer accepted before execute", async () => {
	const waiters = createAskUserQuestionWaiters();
	waiters.expect("tc-invalid");
	const answered = waiters.answer("tc-invalid", { answers: [], cancelled: true });
	const response = await createAskUserQuestionTool(waiters).execute(
		"tc-invalid",
		{
			questions: [
				{
					question: "Which library?",
					header: "Library",
					options: [
						{ label: "Other", description: "reserved" },
						{ label: "Built in", description: "valid" },
					],
				},
			],
		} as never,
		undefined,
		undefined,
		ctx(),
	);
	expect(textOf(response)).toContain("Option label is reserved");
	waiters.persistTurn([{ toolCallId: "tc-invalid", toolName: "ask_user_question" }]);
	if (answered.handled)
		await expect(answered.persisted).rejects.toThrow("accepted answer was not persisted");
});

test("turn_end without the returned answer rejects persistence instead of hanging", async () => {
	const waiters = createAskUserQuestionWaiters();
	const pending = createAskUserQuestionTool(waiters).execute(
		"tc-missing-result",
		args() as never,
		undefined,
		undefined,
		ctx(),
	);
	await Promise.resolve();
	const answered = waiters.answer("tc-missing-result", { answers: [], cancelled: true });
	await pending;
	waiters.persistTurn([]);
	if (answered.handled)
		await expect(answered.persisted).rejects.toThrow("accepted answer was not persisted");
});

test("turn_end clears an expected call that Pi never executed", async () => {
	const waiters = createAskUserQuestionWaiters();
	waiters.expect("tc-skipped");
	expect(waiters.isWaitingForAnswer()).toBe(true);
	expect(waiters.hasRecoverableCall()).toBe(true);
	const answered = waiters.answer("tc-skipped", { answers: [], cancelled: true });
	waiters.persistTurn([]);
	expect(waiters.hasRecoverableCall()).toBe(false);
	if (answered.handled)
		await expect(answered.persisted).rejects.toThrow("accepted answer was not persisted");
});

test("abandon rejects an accepted answer's uncommitted persistence wait", async () => {
	const waiters = createAskUserQuestionWaiters();
	const pending = createAskUserQuestionTool(waiters).execute(
		"tc-dispose",
		args() as never,
		undefined,
		undefined,
		ctx(),
	);
	await Promise.resolve();
	const answered = waiters.answer("tc-dispose", { answers: [], cancelled: true });
	expect(answered.handled).toBe(true);
	await pending;
	waiters.abandon();
	if (answered.handled)
		await expect(answered.persisted).rejects.toThrow(
			"Session disposed while waiting for a question",
		);
});

test("an accepted answer wins over a later Stop before its result boundary", async () => {
	const waiters = createAskUserQuestionWaiters();
	const controller = new AbortController();
	const pending = createAskUserQuestionTool(waiters).execute(
		"tc-answer-wins",
		args() as never,
		controller.signal,
		undefined,
		ctx(),
	);
	await Promise.resolve();
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	};
	const answered = waiters.answer("tc-answer-wins", result);
	controller.abort();
	expect((await pending).details).toEqual(result);
	waiters.persistTurn([persistedAnswer("tc-answer-wins", result)]);
	if (answered.handled) await answered.persisted;
});

test("Stop remains terminal until turn_end and rejects a late answer", async () => {
	const waiters = createAskUserQuestionWaiters();
	const controller = new AbortController();
	const pending = createAskUserQuestionTool(waiters).execute(
		"tc-stop-first",
		args() as never,
		controller.signal,
		undefined,
		ctx(),
	);
	await Promise.resolve();
	controller.abort();
	expect(() => waiters.answer("tc-stop-first", { answers: [], cancelled: true })).toThrow(
		"not awaiting an answer",
	);
	await expect(pending).rejects.toThrow(ASK_STOPPED_ERROR);
	waiters.persistTurn([{ toolCallId: "tc-stop-first", toolName: "ask_user_question" }]);
});

test("a live waiter rejects with the stable stopped result when Pi aborts", async () => {
	const waiters = createAskUserQuestionWaiters();
	const controller = new AbortController();
	const pending = createAskUserQuestionTool(waiters).execute(
		"tc-abort",
		args() as never,
		controller.signal,
		undefined,
		ctx(),
	);
	await Promise.resolve();
	controller.abort(new Error("provider-specific abort text"));
	await expect(pending).rejects.toThrow(ASK_STOPPED_ERROR);
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

test("assessAnswerability: an ack'd, unanswered call is answerable and yields its args", () => {
	const messages = [askCall("tc"), ackResult("tc")];
	const verdict = assessAnswerability(messages, "tc");
	expect(hasQuestionAck(messages, "tc")).toBe(true);
	expect(verdict.ok).toBe(true);
	if (verdict.ok) expect(verdict.args.questions[0]?.question).toBe("Which library?");
});

test("assessAnswerability: a call from a non-executable assistant is terminal", () => {
	for (const stopReason of ["error", "aborted", "length"]) {
		const messages = [askCall("tc-dead", args(), stopReason)];
		expect(assessAnswerability(messages, "tc-dead")).toEqual({
			ok: false,
			reason: "not_awaiting",
		});
		expect(awaitingQuestionToolCallId(messages)).toBeNull();
	}
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
		details: { toolCallId: "tc", result: { answers: "nope" } },
	} as unknown as AgentMessage;
	expect(assessAnswerability([askCall("tc"), ackResult("tc"), malformed], "tc").ok).toBe(true);
});

test("assessAnswerability: the tiny pre-ack window (call ended, result not yet) is answerable", () => {
	expect(assessAnswerability([askCall("tc")], "tc").ok).toBe(true);
});

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
