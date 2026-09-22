import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createDelegationService, DelegationError, type DelegationErrorCode } from "../index";

const core = createDelegationService({});
function assistant(
	calls: Array<{ id: string; name: string }> = [],
	stopReason: AssistantMessage["stopReason"] = calls.length ? "toolUse" : "stop",
): AssistantMessage {
	return {
		...fauxAssistantMessage(
			calls.length ? calls.map((call) => ({ type: "toolCall", ...call, arguments: {} })) : "answer",
		),
		stopReason,
	};
}
function capture(manager: SessionManager, entryId: string | null = manager.getLeafId()) {
	return core.captureHistory({
		kind: "session",
		sessionId: manager.getSessionId(),
		sessionManager: manager,
		cut: { kind: "at-entry", entryId },
	});
}
function result(toolCallId: string, toolName: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: "result" }],
		isError: false,
		timestamp: Date.now(),
	};
}
async function code(promise: Promise<unknown>, expected: DelegationErrorCode) {
	await expect(promise).rejects.toBeInstanceOf(DelegationError);
	await expect(promise).rejects.toHaveProperty("code", expected);
}

test("session capture detaches the selected branch, max thinking and canonical UTF-8 bytes synchronously", async () => {
	const manager = SessionManager.inMemory("/synthetic");
	manager.appendThinkingLevelChange("max");
	const root = manager.appendMessage({
		role: "user",
		content: "Unicode 🌲",
		timestamp: Date.now(),
	});
	manager.appendMessage(assistant());
	const pending = capture(manager);
	const header = manager.getHeader();
	const branch = manager.getBranch();
	const expected = `${[header, ...branch].map((entry) => JSON.stringify(entry)).join("\n")}\n`;
	manager.branch(root);
	manager.appendCustomEntry("other-branch", { private: "EXCLUDED" });
	const history = await pending;
	expect(history.jsonl).toBe(expected);
	expect(history.sizeBytes).toBe(Buffer.byteLength(expected, "utf8"));
	expect(history.sha256).toBe(createHash("sha256").update(expected).digest("hex"));
	expect(history.jsonl).not.toContain("EXCLUDED");
	expect(history.jsonl).toContain('"thinkingLevel":"max"');
	expect(manager.getBranch().at(-1)?.type).toBe("custom");
});

test("null is an empty prefix and never calls the readonly getBranch with null", async () => {
	const manager = SessionManager.inMemory("/synthetic");
	manager.appendMessage(assistant());
	manager.getBranch = () => {
		throw new Error("No branch lookup for an empty cut");
	};
	const history = await capture(manager, null);
	expect(history.entryId).toBeNull();
	expect(history.jsonl.trim().split("\n")).toHaveLength(1);
});

test("before-tool-call excludes the whole invoking batch even after sibling results", async () => {
	const manager = SessionManager.inMemory("/synthetic");
	manager.appendMessage({ role: "user", content: "before", timestamp: Date.now() });
	const boundary = manager.getLeafId();
	manager.appendMessage(
		assistant([
			{ id: "caller", name: "dag" },
			{ id: "sibling", name: "read" },
		]),
	);
	manager.appendMessage(result("sibling", "read"));
	const leaf = manager.getLeafId();
	const beforeTool = (toolCallId: string) =>
		core.captureHistory({
			kind: "session",
			sessionId: manager.getSessionId(),
			sessionManager: manager,
			cut: { kind: "before-tool-call", toolCallId },
		});
	const history = await beforeTool("caller");
	expect(history.entryId).toBe(boundary);
	expect(history.jsonl).not.toContain("caller");
	expect(history.jsonl).not.toContain("sibling");
	expect(manager.getLeafId()).toBe(leaf);
	await code(beforeTool("missing"), "invalid-history");
	manager.appendMessage(assistant([{ id: "caller", name: "dag" }]));
	await code(beforeTool("caller"), "invalid-history");
});

test("capture rejects wrong identity, cuts, v3 shape and ancestry without source mutation", async () => {
	const manager = SessionManager.inMemory("/synthetic");
	manager.appendMessage(assistant());
	await code(
		core.captureHistory({
			kind: "session",
			sessionId: "wrong",
			sessionManager: manager,
			cut: { kind: "at-entry", entryId: null },
		}),
		"invalid-history",
	);
	await code(capture(manager, "missing"), "invalid-history");
	const header = manager.getHeader();
	if (!header) throw new Error("Missing header");
	manager.getHeader = () => ({ ...header, version: 2 });
	await code(capture(manager), "invalid-history");
	manager.getHeader = () => header;
	const branch = manager.getBranch();
	const entry = branch[0];
	if (!entry) throw new Error("Missing fixture entry");
	for (const invalid of [
		[{ ...entry, timestamp: "invalid" }],
		[{ ...entry, parentId: "missing" }],
		[{ ...entry, parentId: entry.id }],
		[entry, entry],
	]) {
		manager.getBranch = () => invalid;
		await code(capture(manager, entry.id), "invalid-history");
	}
	manager.getBranch = () => branch;
	expect((await capture(manager)).entryId).toBe(entry.id);
});

test("replay closure rejects partial batches, orphan/duplicate results, names and duplicate call ids", async () => {
	const read = { id: "a", name: "read" };
	const call = assistant([read]);
	const completed = result(read.id, read.name);
	for (const messages of [
		[call],
		[completed],
		[call, result(read.id, "bash")],
		[call, completed, completed],
		[assistant([read, read]), completed],
		[assistant([read, { id: "b", name: "bash" }]), completed],
		[call, assistant()],
	]) {
		const manager = SessionManager.inMemory("/synthetic");
		for (const message of messages) manager.appendMessage(message);
		await code(capture(manager), "incomplete-history");
	}
});

test("failed/aborted attempts do not require successful tool results, and a complete batch captures", async () => {
	const manager = SessionManager.inMemory("/synthetic");
	manager.appendMessage(assistant([{ id: "failed", name: "read" }], "error"));
	manager.appendMessage(assistant([{ id: "aborted", name: "read" }], "aborted"));
	manager.appendMessage(assistant([{ id: "success", name: "read" }]));
	manager.appendMessage(result("success", "read"));
	expect((await capture(manager)).entryId).toBe(manager.getLeafId());
});

test("compaction closure uses pi replay, preserves label first-kept references and off-path provenance", async () => {
	const manager = SessionManager.inMemory("/synthetic");
	const dangling = manager.appendMessage(assistant([{ id: "summarized-dangling", name: "read" }]));
	const offPath = manager.appendCustomEntry("off-path", { excluded: "UNRELATED" });
	manager.branch(dangling);
	manager.appendLabelChange(offPath, "retained label");
	const label = manager.getLeafId();
	if (!label) throw new Error("Missing label");
	manager.appendMessage({ role: "user", content: "kept", timestamp: Date.now() });
	manager.appendCompaction("summary", label, 100);
	const history = await capture(manager);
	expect(history.jsonl).toContain(`"firstKeptEntryId":"${label}"`);
	expect(history.jsonl).toContain(offPath);
	expect(history.jsonl).not.toContain("UNRELATED");
	expect(history.jsonl).toContain("summarized-dangling");
	manager.appendMessage(assistant([{ id: "new-dangling", name: "read" }]));
	await code(capture(manager), "incomplete-history");
	manager.branch(dangling);
	manager.appendCompaction("invalid", offPath, 100);
	await code(capture(manager), "invalid-history");
});
