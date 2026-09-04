import { expect, test } from "bun:test";
import type { AgentMessage } from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import { type ActivityInputs, deriveActivityStatus } from "./activity";
import { ASK_ACK_TEXT, awaitingQuestionToolCallId } from "./askUserQuestion";

const askCall = (toolCallId: string) =>
	({
		role: "assistant",
		content: [
			{ type: "toolCall", id: toolCallId, name: "ask_user_question", arguments: { questions: [] } },
		],
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

const answersMessage = (toolCallId: string) =>
	({
		role: "custom",
		customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
		content: "User has answered your questions: …",
		display: true,
		details: { toolCallId, result: { answers: [], cancelled: false } },
	}) as unknown as AgentMessage;

const userMessage = () =>
	({
		role: "user",
		content: [{ type: "text", text: "do this instead" }],
	}) as unknown as AgentMessage;

const awaiting = [askCall("tc-1"), ackResult("tc-1")];

const inputs = (over: Partial<ActivityInputs> = {}): ActivityInputs => ({
	isStreaming: false,
	pendingMessageCount: 0,
	messages: [],
	lastSettlement: undefined,
	hasPendingDialog: false,
	...over,
});

test("a session at rest with nothing to report is idle, expressed as null", () => {
	expect(deriveActivityStatus(inputs())).toBeNull();
});

test("a streaming session is running", () => {
	expect(deriveActivityStatus(inputs({ isStreaming: true }))).toBe("running");
});

test("a blocking extension dialog outranks streaming — the user is the blocker, not pi", () => {
	expect(deriveActivityStatus(inputs({ isStreaming: true, hasPendingDialog: true }))).toBe(
		"waiting",
	);
});

test("an unanswered ask_user_question is waiting", () => {
	expect(deriveActivityStatus(inputs({ messages: awaiting }))).toBe("waiting");
});

test("an answered questionnaire is no longer waiting", () => {
	expect(
		deriveActivityStatus(inputs({ messages: [...awaiting, answersMessage("tc-1")] })),
	).toBeNull();
});

test("a later user message supersedes the questionnaire", () => {
	expect(deriveActivityStatus(inputs({ messages: [...awaiting, userMessage()] }))).toBeNull();
});

test("an errored settlement is failed", () => {
	expect(deriveActivityStatus(inputs({ lastSettlement: { stopReason: "error" } }))).toBe("failed");
});

test("a cancelled run is idle, not failed — aborting is not a fault", () => {
	expect(deriveActivityStatus(inputs({ lastSettlement: { stopReason: "aborted" } }))).toBeNull();
});

test("queued outranks failed: a follow-up you already sent means the failure is handled", () => {
	expect(
		deriveActivityStatus(
			inputs({ pendingMessageCount: 1, lastSettlement: { stopReason: "error" } }),
		),
	).toBe("queued");
});

test("queued outranks waiting: a queued message supersedes the question before it lands in the transcript", () => {
	expect(deriveActivityStatus(inputs({ pendingMessageCount: 1, messages: awaiting }))).toBe(
		"queued",
	);
});

test("running outranks queued: a message queued mid-run does not mask the run", () => {
	expect(deriveActivityStatus(inputs({ isStreaming: true, pendingMessageCount: 2 }))).toBe(
		"running",
	);
});

test("awaitingQuestionToolCallId names the call, so waiting is never guessed from a bare count", () => {
	expect(awaitingQuestionToolCallId(awaiting)).toBe("tc-1");
	expect(awaitingQuestionToolCallId([...awaiting, answersMessage("tc-1")])).toBeNull();
	expect(awaitingQuestionToolCallId([])).toBeNull();
});

test("only the most recent questionnaire decides — an old answered one does not linger", () => {
	const messages = [
		askCall("tc-1"),
		ackResult("tc-1"),
		answersMessage("tc-1"),
		askCall("tc-2"),
		ackResult("tc-2"),
	];
	expect(awaitingQuestionToolCallId(messages)).toBe("tc-2");
	expect(deriveActivityStatus(inputs({ messages }))).toBe("waiting");
});
