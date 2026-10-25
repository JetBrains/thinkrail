import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	AgentMessage,
	AskUserQuestionArgs,
	AskUserQuestionResult,
} from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import { buildQuestionnaireResponse, serverExtensions } from "../extensions";
import {
	ASK_ACK_TEXT,
	ASK_STOPPED_ERROR,
	type AskUserQuestionWaiters,
	askUserQuestionSessionServices,
	assessAnswerability,
	awaitingQuestionToolCallId,
	buildAnswersMessage,
	createAskUserQuestionWaiters,
	hasQuestionAck,
} from "./askUserQuestion";

interface AskToolResult {
	content: { type: string; text?: string }[];
	details: unknown;
	terminate?: boolean;
}

interface AskTool {
	executionMode?: string;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: unknown,
	) => Promise<AskToolResult>;
}

type MessageEndHook = (event: { message: unknown }) => { message: unknown } | undefined;

function composeAsk(waiters: AskUserQuestionWaiters): {
	tool: AskTool;
	messageEnd: MessageEndHook | undefined;
} {
	const entry = serverExtensions.find(
		(candidate) => candidate.extension.name === "ask-user-question",
	);
	const services = askUserQuestionSessionServices(waiters);
	let tool: AskTool | undefined;
	let messageEnd: MessageEndHook | undefined;
	const pi = {
		registerTool: (definition: AskTool) => {
			tool = definition;
		},
		on: (event: string, handler: MessageEndHook) => {
			if (event === "message_end") messageEnd = handler;
		},
	} as unknown as ExtensionAPI;
	for (const factory of entry?.extension.sessionExtensions?.(services) ?? []) factory(pi);
	if (!tool) throw new Error("the ask-user-question extension registered no tool");
	return { tool, messageEnd };
}

const askTool = (waiters: AskUserQuestionWaiters): AskTool => composeAsk(waiters).tool;

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

const ctx = (hasUI = true): unknown => ({ hasUI });

const run = (hasUI = true, params: AskUserQuestionArgs = args()) =>
	askTool(createAskUserQuestionWaiters()).execute("tc-1", params, undefined, undefined, ctx(hasUI));

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

test("the host path accepts more than four questions in one call", async () => {
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

	const waiters = createAskUserQuestionWaiters();
	const pending = askTool(waiters).execute("tc-many", many, undefined, undefined, ctx());
	await Promise.resolve();
	const answered = waiters.answer("tc-many", { answers: [], cancelled: true });
	expect(answered.handled).toBe(true);
	expect(textOf(await pending)).toContain("declined");
	waiters.persistTurn(
		[persistedAnswer("tc-many", { answers: [], cancelled: true }, many)],
		askCall("tc-many", many),
	);
	if (answered.handled) await answered.persisted;
});

test("the composed extension keeps the first ask as its batch's only tool call", () => {
	const { messageEnd } = composeAsk(createAskUserQuestionWaiters());
	const message = {
		role: "assistant",
		content: [
			{ type: "text", text: "I need input." },
			{ type: "toolCall", id: "read-1", name: "read", arguments: {} },
			{ type: "toolCall", id: "ask-1", name: "ask_user_question", arguments: args() },
			{ type: "toolCall", id: "ask-2", name: "ask_user_question", arguments: args() },
		],
	};
	const isolated = messageEnd?.({ message })?.message as {
		content: { type: string; id?: string }[];
	};
	expect(isolated.content.map((block) => block.id ?? block.type)).toEqual(["text", "ask-1"]);
});

test("a valid live execution is sequential, blocks for its answer, and returns the real result", async () => {
	const waiters = createAskUserQuestionWaiters();
	const tool = askTool(waiters);
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
	expect(waiters.currentQuestion()).toEqual({ interactionId: "tc-1", needsInput: true });
	expect(waiters.hasRecoverableCall()).toBe(true);

	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	};
	const answered = waiters.answer("tc-1", result);
	expect(answered.handled).toBe(true);
	expect(waiters.currentQuestion()).toEqual({ interactionId: "tc-1", needsInput: false });
	expect(waiters.hasRecoverableCall()).toBe(true);
	const response = await pending;
	expect(textOf(response)).toContain('"Which library?"="luxon"');
	expect(response.details).toEqual(result);
	expect((response as { terminate?: boolean }).terminate).toBeUndefined();
	waiters.persistTurn([persistedAnswer("tc-1", result)], askCall("tc-1"));
	if (answered.handled) await answered.persisted;
	expect(waiters.hasRecoverableCall()).toBe(false);
});

test("an accepted answer persists only as the envelope built from the call's own arguments", async () => {
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	};
	const twoQuestions = args({
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
	const cases: [string, ReturnType<typeof persistedAnswer>, AgentMessage | undefined][] = [
		[
			"replaced content",
			{ ...persistedAnswer("tc-proof", result), content: [{ type: "text", text: "rewritten" }] },
			askCall("tc-proof"),
		],
		["unknown arguments", persistedAnswer("tc-proof", result), undefined],
		["other arguments", persistedAnswer("tc-proof", result), askCall("tc-proof", twoQuestions)],
	];
	for (const [label, persisted, assistant] of cases) {
		const waiters = createAskUserQuestionWaiters();
		const pending = askTool(waiters).execute("tc-proof", args(), undefined, undefined, ctx());
		await Promise.resolve();
		const answered = waiters.answer("tc-proof", result);
		await pending;
		waiters.persistTurn([persisted], assistant);
		if (!answered.handled) throw new Error(label);
		await expect(answered.persisted).rejects.toThrow("accepted answer was not persisted");
	}
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
	const response = await askTool(waiters).execute("tc-early", args(), undefined, undefined, ctx());
	expect(response.details).toEqual(result);
	waiters.persistTurn([persistedAnswer("tc-early", result)], askCall("tc-early"));
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
	const response = await askTool(waiters).execute(
		"tc-early-stop",
		args(),
		controller.signal,
		undefined,
		ctx(),
	);
	expect(response.details).toEqual(result);
	waiters.persistTurn([persistedAnswer("tc-early-stop", result)], askCall("tc-early-stop"));
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
	const pending = askTool(waiters).execute(
		"tc-shutdown-accepted",
		args(),
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
	waiters.persistTurn(
		[persistedAnswer("tc-shutdown-accepted", { answers: [], cancelled: true })],
		askCall("tc-shutdown-accepted"),
	);
	await settling;
});

test("explicit Stop claims an expected call before execute or a late answer can win", async () => {
	const waiters = createAskUserQuestionWaiters();
	waiters.expect("tc-stop-expected");
	expect(waiters.prepareAbort()).toBeNull();
	expect(waiters.currentQuestion()?.needsInput).toBe(false);
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
	const response = await askTool(waiters).execute(
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
		},
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
	const pending = askTool(waiters).execute(
		"tc-missing-result",
		args(),
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
	expect(waiters.currentQuestion()).toEqual({ interactionId: "tc-skipped", needsInput: true });
	expect(waiters.hasRecoverableCall()).toBe(true);
	const answered = waiters.answer("tc-skipped", { answers: [], cancelled: true });
	waiters.persistTurn([]);
	expect(waiters.hasRecoverableCall()).toBe(false);
	if (answered.handled)
		await expect(answered.persisted).rejects.toThrow("accepted answer was not persisted");
});

test("abandon rejects an accepted answer's uncommitted persistence wait", async () => {
	const waiters = createAskUserQuestionWaiters();
	const pending = askTool(waiters).execute("tc-dispose", args(), undefined, undefined, ctx());
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
	const pending = askTool(waiters).execute(
		"tc-answer-wins",
		args(),
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
	waiters.persistTurn([persistedAnswer("tc-answer-wins", result)], askCall("tc-answer-wins"));
	if (answered.handled) await answered.persisted;
});

test("Stop remains terminal until turn_end and rejects a late answer", async () => {
	const waiters = createAskUserQuestionWaiters();
	const controller = new AbortController();
	const pending = askTool(waiters).execute(
		"tc-stop-first",
		args(),
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
	const pending = askTool(waiters).execute("tc-abort", args(), controller.signal, undefined, ctx());
	await Promise.resolve();
	controller.abort(new Error("provider-specific abort text"));
	await expect(pending).rejects.toThrow(ASK_STOPPED_ERROR);
});

test("a user message typed past a waiting call supersedes it with the canonical ack", async () => {
	const waiters = createAskUserQuestionWaiters();
	const pending = askTool(waiters).execute("tc-typed-past", args(), undefined, undefined, ctx());
	await Promise.resolve();
	expect(waiters.currentQuestion()?.needsInput).toBe(true);
	expect(waiters.supersede()).toBe(true);
	expect(waiters.hasRecoverableCall()).toBe(false);
	expect(waiters.currentQuestion()).toEqual({ interactionId: "tc-typed-past", needsInput: false });
	const response = await pending;
	expect(textOf(response)).toBe(ASK_ACK_TEXT);
	expect(response.details).toEqual({ kind: "ack" });
	expect(response.terminate).toBe(true);
	expect(() => waiters.answer("tc-typed-past", { answers: [], cancelled: true })).toThrow(
		"superseded by a later message",
	);
	expect(waiters.supersede()).toBe(false);
	waiters.persistTurn([
		{ toolCallId: "tc-typed-past", toolName: "ask_user_question", ...(await pending) },
	]);
	expect(waiters.currentQuestion()).toBeNull();
});

test("a user message typed in the pre-execute window supersedes the expected call", async () => {
	const waiters = createAskUserQuestionWaiters();
	waiters.expect("tc-typed-early");
	expect(waiters.supersede()).toBe(true);
	const response = await askTool(waiters).execute(
		"tc-typed-early",
		args(),
		undefined,
		undefined,
		ctx(),
	);
	expect(response.details).toEqual({ kind: "ack" });
	waiters.persistTurn([]);
});

test("supersede never reverses an answer that was already accepted", async () => {
	const waiters = createAskUserQuestionWaiters();
	const pending = askTool(waiters).execute(
		"tc-answered-first",
		args(),
		undefined,
		undefined,
		ctx(),
	);
	await Promise.resolve();
	const result: AskUserQuestionResult = {
		cancelled: false,
		answers: [{ questionIndex: 0, question: "Which library?", kind: "option", answer: "luxon" }],
	};
	const answered = waiters.answer("tc-answered-first", result);
	expect(waiters.supersede()).toBe(false);
	expect((await pending).details).toEqual(result);
	waiters.persistTurn([persistedAnswer("tc-answered-first", result)], askCall("tc-answered-first"));
	if (answered.handled) await answered.persisted;
});

test("supersede leaves a stopped call stopped", async () => {
	const waiters = createAskUserQuestionWaiters();
	waiters.expect("tc-stopped");
	waiters.prepareAbort();
	expect(waiters.supersede()).toBe(false);
	await expect(waiters.wait("tc-stopped", undefined)).rejects.toThrow(ASK_STOPPED_ERROR);
	waiters.persistTurn([]);
});

test("the host's asker answers without pi's own UI, because the chat is the UI", async () => {
	const waiters = createAskUserQuestionWaiters();
	const pending = askTool(waiters).execute("tc-no-pi-ui", args(), undefined, undefined, ctx(false));
	await Promise.resolve();
	const answered = waiters.answer("tc-no-pi-ui", { answers: [], cancelled: true });
	expect(answered.handled).toBe(true);
	expect(textOf(await pending)).toContain("declined");
	waiters.persistTurn(
		[persistedAnswer("tc-no-pi-ui", { answers: [], cancelled: true })],
		askCall("tc-no-pi-ui"),
	);
	if (answered.handled) await answered.persisted;
});

test("execute returns a validation error (non-terminating) for a malformed questionnaire", async () => {
	const r = await run(true, { questions: [] });
	expect(textOf(r)).toContain("At least one question is required");
	expect((r.details as AskUserQuestionResult).cancelled).toBe(true);
	expect(r.terminate).toBeUndefined();
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
