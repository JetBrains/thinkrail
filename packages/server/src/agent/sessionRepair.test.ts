import { expect, test } from "bun:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Message } from "@thinkrail/contracts";
import { repairDanglingToolCalls } from "./sessionRepair";

const assistantWithCalls = (
	calls: { id: string; name: string; args?: Record<string, unknown> }[],
	stopReason: "toolUse" | "error" | "aborted" = "toolUse",
): Message =>
	({
		role: "assistant",
		content: calls.map((c) => ({
			type: "toolCall",
			id: c.id,
			name: c.name,
			arguments: c.args ?? {},
		})),
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		stopReason,
		timestamp: Date.now(),
	}) as unknown as Message;

const assistantText = (text: string): Message =>
	({
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		stopReason: "stop",
		timestamp: Date.now(),
	}) as unknown as Message;

const toolResult = (toolCallId: string, toolName: string): Message =>
	({
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: Date.now(),
	}) as unknown as Message;

const user = (text: string): Message =>
	({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }) as Message;

test("a healthy transcript is untouched", () => {
	const sm = SessionManager.inMemory("/tmp/repair-test");
	sm.appendMessage(user("hi"));
	sm.appendMessage(assistantWithCalls([{ id: "b1", name: "bash" }]));
	sm.appendMessage(toolResult("b1", "bash"));
	const before = sm.buildSessionContext().messages.length;
	expect(repairDanglingToolCalls(sm)).toEqual([]);
	expect(sm.buildSessionContext().messages.length).toBe(before);
});

test("a dangling generic tool call gets an error 'Operation aborted' result", () => {
	const sm = SessionManager.inMemory("/tmp/repair-test");
	sm.appendMessage(user("run it"));
	sm.appendMessage(assistantWithCalls([{ id: "b1", name: "bash" }]));
	expect(repairDanglingToolCalls(sm)).toEqual([{ toolCallId: "b1", toolName: "bash" }]);
	const { messages } = sm.buildSessionContext();
	const repaired = messages.find((m) => m.role === "toolResult");
	expect(repaired).toBeDefined();
	if (repaired?.role !== "toolResult") throw new Error("unreachable");
	expect(repaired.toolCallId).toBe("b1");
	expect(repaired.isError).toBe(true);
	expect((repaired.content[0] as { text?: string }).text ?? "").toContain("host restarted");
	expect(repairDanglingToolCalls(sm)).toEqual([]);
});

test("a dangling ask_user_question (old blocking format) resolves as the canonical decline", () => {
	const sm = SessionManager.inMemory("/tmp/repair-test");
	sm.appendMessage(user("decide"));
	sm.appendMessage(assistantWithCalls([{ id: "q1", name: "ask_user_question" }]));
	expect(repairDanglingToolCalls(sm)).toEqual([
		{ toolCallId: "q1", toolName: "ask_user_question" },
	]);
	const repaired = sm.buildSessionContext().messages.find((m) => m.role === "toolResult");
	if (repaired?.role !== "toolResult") throw new Error("unreachable");
	expect(repaired.isError).toBe(false);
	expect(repaired.details).toEqual({ answers: [], cancelled: true });
	const text = (repaired.content[0] as { text?: string }).text ?? "";
	expect(text).toContain("User declined to answer questions");
	expect(text).toContain("ask again if still relevant");
});

test("several orphans in one batch are all paired (mixed ask + generic)", () => {
	const sm = SessionManager.inMemory("/tmp/repair-test");
	sm.appendMessage(user("both"));
	sm.appendMessage(
		assistantWithCalls([
			{ id: "b1", name: "bash" },
			{ id: "q1", name: "ask_user_question" },
		]),
	);
	const repaired = repairDanglingToolCalls(sm);
	expect(repaired.map((r) => r.toolCallId).sort()).toEqual(["b1", "q1"]);
	const results = sm.buildSessionContext().messages.filter((m) => m.role === "toolResult");
	expect(results).toHaveLength(2);
});

test("a partially completed tail batch repairs only the missing calls", () => {
	const sm = SessionManager.inMemory("/tmp/repair-test");
	sm.appendMessage(user("both"));
	sm.appendMessage(
		assistantWithCalls([
			{ id: "b1", name: "read" },
			{ id: "b2", name: "bash" },
		]),
	);
	sm.appendMessage(toolResult("b1", "read"));
	expect(repairDanglingToolCalls(sm)).toEqual([{ toolCallId: "b2", toolName: "bash" }]);
	expect(repairDanglingToolCalls(sm)).toEqual([]);
});

test("an errored tool call followed by a successful retry is never repaired", () => {
	const sm = SessionManager.inMemory("/tmp/repair-test");
	sm.appendMessage(user("write it"));
	sm.appendMessage(assistantWithCalls([{ id: "failed", name: "write" }], "error"));
	sm.appendMessage(assistantWithCalls([{ id: "retry", name: "write" }]));
	sm.appendMessage(toolResult("retry", "write"));
	sm.appendMessage(assistantText("done"));
	expect(repairDanglingToolCalls(sm)).toEqual([]);
	expect(
		sm
			.buildSessionContext()
			.messages.some((message) => message.role === "toolResult" && message.toolCallId === "failed"),
	).toBe(false);
});

test("errored and aborted tail attempts never contribute repair candidates", () => {
	for (const stopReason of ["error", "aborted"] as const) {
		const sm = SessionManager.inMemory("/tmp/repair-test");
		sm.appendMessage(user("run it"));
		sm.appendMessage(assistantWithCalls([{ id: stopReason, name: "bash" }], stopReason));
		expect(repairDanglingToolCalls(sm)).toEqual([]);
	}
});

test("errored and aborted attempts close an older repair candidate", () => {
	for (const stopReason of ["error", "aborted"] as const) {
		const sm = SessionManager.inMemory("/tmp/repair-test");
		sm.appendMessage(user("run it"));
		sm.appendMessage(assistantWithCalls([{ id: "old", name: "bash" }]));
		sm.appendMessage(assistantWithCalls([], stopReason));
		expect(repairDanglingToolCalls(sm)).toEqual([]);
	}
});

test("a historical orphan is not repaired after a later replayable message", () => {
	const sm = SessionManager.inMemory("/tmp/repair-test");
	sm.appendMessage(user("run it"));
	sm.appendMessage(assistantWithCalls([{ id: "old", name: "bash" }]));
	sm.appendMessage(assistantText("recovered"));
	expect(repairDanglingToolCalls(sm)).toEqual([]);
});

test("malformed trailing results prevent repair of the preceding batch", () => {
	const malformedResults = [
		[toolResult("foreign", "read")],
		[toolResult("expected", "write")],
		[toolResult("expected", "bash"), toolResult("expected", "bash")],
	];
	for (const results of malformedResults) {
		const sm = SessionManager.inMemory("/tmp/repair-test");
		sm.appendMessage(user("run it"));
		sm.appendMessage(
			assistantWithCalls([
				{ id: "expected", name: "bash" },
				{ id: "missing", name: "read" },
			]),
		);
		for (const result of results) sm.appendMessage(result);
		expect(repairDanglingToolCalls(sm)).toEqual([]);
	}
});

test("only calls on the context path are considered — resulted calls never re-repair", () => {
	const sm = SessionManager.inMemory("/tmp/repair-test");
	sm.appendMessage(user("go"));
	sm.appendMessage(assistantWithCalls([{ id: "b1", name: "bash" }]));
	sm.appendMessage(toolResult("b1", "bash"));
	sm.appendMessage(assistantWithCalls([{ id: "b2", name: "bash" }]));
	expect(repairDanglingToolCalls(sm).map((r) => r.toolCallId)).toEqual(["b2"]);
});
