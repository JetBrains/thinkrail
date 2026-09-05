import { expect, test } from "bun:test";
import type { AgentMessage, StopReason } from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import {
	type ActivityInputs,
	deriveActivityStatus,
	deriveDiskActivityStatus,
	parseTranscriptTail,
} from "./activity";
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

const assistant = (stopReason: string) =>
	({
		role: "assistant",
		content: [{ type: "text", text: "…" }],
		stopReason,
	}) as unknown as AgentMessage;

test("an attached session whose transcript ends in a failure is failed, so a restart keeps the glyph", () => {
	expect(deriveActivityStatus(inputs({ messages: [userMessage(), assistant("error")] }))).toBe(
		"failed",
	);
});

test("a transcript ending in a clean stop is idle", () => {
	expect(deriveActivityStatus(inputs({ messages: [userMessage(), assistant("stop")] }))).toBeNull();
});

test("a retried failure is not failed — the succeeding attempt is the trailing assistant", () => {
	expect(
		deriveActivityStatus(
			inputs({ messages: [userMessage(), assistant("error"), assistant("stop")] }),
		),
	).toBeNull();
});

test("a user message after a failure clears it — asking again is not still-broken", () => {
	expect(
		deriveActivityStatus(inputs({ messages: [assistant("error"), userMessage()] })),
	).toBeNull();
});

test("an explicit null settlement outranks the transcript, so an old failure cannot reappear mid-run", () => {
	expect(
		deriveActivityStatus(
			inputs({ lastSettlement: null, messages: [userMessage(), assistant("error")] }),
		),
	).toBeNull();
});

test("an observed settlement always wins over the transcript, in both directions", () => {
	expect(
		deriveActivityStatus(
			inputs({
				lastSettlement: { stopReason: "error" },
				messages: [userMessage(), assistant("stop")],
			}),
		),
	).toBe("failed");
	expect(
		deriveActivityStatus(
			inputs({
				lastSettlement: { stopReason: "stop" },
				messages: [userMessage(), assistant("error")],
			}),
		),
	).toBeNull();
});

test("a truncated run is failed too — the rail must not call idle what the chat calls an error", () => {
	expect(deriveActivityStatus(inputs({ lastSettlement: { stopReason: "length" } }))).toBe("failed");
	expect(deriveActivityStatus(inputs({ messages: [userMessage(), assistant("length")] }))).toBe(
		"failed",
	);
});

test("error and length are classified identically on both the settlement and transcript paths", () => {
	for (const stopReason of ["error", "length"] as const) {
		expect(
			deriveActivityStatus(inputs({ lastSettlement: { stopReason: stopReason as StopReason } })),
		).toBe("failed");
		expect(deriveActivityStatus(inputs({ messages: [userMessage(), assistant(stopReason)] }))).toBe(
			"failed",
		);
	}
	for (const stopReason of ["stop", "toolUse", "aborted"] as const) {
		expect(
			deriveActivityStatus(inputs({ lastSettlement: { stopReason: stopReason as StopReason } })),
		).toBeNull();
		expect(
			deriveActivityStatus(inputs({ messages: [userMessage(), assistant(stopReason)] })),
		).toBeNull();
	}
});

const entry = (message: unknown) => JSON.stringify({ type: "message", id: "e", message });

test("a transcript tail parses only message entries, ignoring session headers and junk", () => {
	const text = [
		JSON.stringify({ type: "session", id: "s1", cwd: "/w" }),
		entry({ role: "user", content: [{ type: "text", text: "go" }] }),
		"not json at all",
		JSON.stringify({ type: "summary", id: "x" }),
		entry({ role: "assistant", content: [], stopReason: "error" }),
		"",
	].join("\n");
	const messages = parseTranscriptTail(text, false);
	expect(messages.map((m) => (m as { role: string }).role)).toEqual(["user", "assistant"]);
});

test("a truncated window drops its partial first line rather than parsing half an entry", () => {
	const text = ['e": "hal', entry({ role: "assistant", content: [], stopReason: "error" })].join(
		"\n",
	);
	expect(parseTranscriptTail(text, true)).toHaveLength(1);
	expect(parseTranscriptTail(text, false)).toHaveLength(1);
});

test("a disk session can only ever be waiting, failed, or idle — never running or queued", () => {
	expect(deriveDiskActivityStatus([userMessage(), assistant("error")])).toBe("failed");
	expect(deriveDiskActivityStatus([userMessage(), assistant("length")])).toBe("failed");
	expect(deriveDiskActivityStatus(awaiting)).toBe("waiting");
	expect(deriveDiskActivityStatus([userMessage(), assistant("stop")])).toBeNull();
	expect(deriveDiskActivityStatus([])).toBeNull();
});

test("the disk derivation runs the SAME precedence as a live session, not a copy of it", () => {
	const messages = [...awaiting];
	expect(deriveDiskActivityStatus(messages)).toBe(
		deriveActivityStatus(inputs({ messages, lastSettlement: undefined })),
	);
});
