import { expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMessage, StopReason } from "@thinkrail/contracts";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "@thinkrail/contracts";
import { ASK_ACK_TEXT } from "./askUserQuestion";
import {
	type AttentionInputs,
	deriveAttentionCandidate,
	deriveDiskAttentionCandidate,
	parseAttentionEntries,
} from "./attention";

function message(id: string, parentId: string | null, value: AgentMessage): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: value,
	};
}

function user(id = "user-1", parentId: string | null = null): SessionEntry {
	return message(id, parentId, {
		role: "user",
		content: [{ type: "text", text: "do it" }],
		timestamp: 1,
	} as unknown as AgentMessage);
}

function assistant(
	id: string,
	parentId: string,
	stopReason: StopReason | "unfinished" | undefined,
): SessionEntry {
	return message(id, parentId, {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		stopReason,
		timestamp: 2,
	} as unknown as AgentMessage);
}

function questionEntries(): SessionEntry[] {
	const userEntry = user();
	const call = message("ask-entry", userEntry.id, {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "tc-1",
				name: "ask_user_question",
				arguments: { questions: [] },
			},
		],
		stopReason: "toolUse",
		timestamp: 2,
	} as unknown as AgentMessage);
	const ack = message("ack-entry", call.id, {
		role: "toolResult",
		toolCallId: "tc-1",
		toolName: "ask_user_question",
		content: [{ type: "text", text: ASK_ACK_TEXT }],
		details: { kind: "ack" },
		isError: false,
		timestamp: 3,
	} as unknown as AgentMessage);
	return [userEntry, call, ack];
}

function inputs(
	entries: readonly SessionEntry[],
	over: Partial<AttentionInputs> = {},
): AttentionInputs {
	return {
		entries,
		isStreaming: false,
		pendingMessageCount: 0,
		lastSettlement: undefined,
		pendingDialogId: null,
		...over,
	};
}

test("successful, error, and length outcomes share one review candidate shape", () => {
	for (const stopReason of ["stop", "error", "length"] as const) {
		const entries = [user(), assistant(`assistant-${stopReason}`, "user-1", stopReason)];
		const candidate = deriveDiskAttentionCandidate(entries);
		expect(candidate).toMatchObject({ kind: "review", turnId: "user-1" });
		expect(candidate?.id).toStartWith("review:");
	}
});

test("review fingerprints survive legacy normalization and distinguish repeated identical results", () => {
	const current = [user(), assistant("assistant-1", "user-1", "stop")];
	const currentId = deriveDiskAttentionCandidate(current)?.id;
	const legacySource = current
		.map((entry) => {
			const { id: _id, parentId: _parentId, ...legacy } = entry;
			return JSON.stringify(legacy);
		})
		.join("\n");
	const currentCandidate = deriveDiskAttentionCandidate(current);
	const legacyCandidate = deriveDiskAttentionCandidate(parseAttentionEntries(legacySource, false));
	expect(legacyCandidate?.id).toStartWith("legacy-review:");
	expect(currentCandidate?.aliases).toContain(legacyCandidate?.id);
	const trailing = message("tool-result", "assistant-1", {
		role: "toolResult",
		toolCallId: "tool-1",
		toolName: "tool",
		content: [{ type: "text", text: "later metadata" }],
		isError: false,
		timestamp: 2,
	} as unknown as AgentMessage);
	expect(deriveDiskAttentionCandidate([...current, trailing])?.id).toBe(currentId);
	const repeated = [
		...current,
		user("user-2", "assistant-1"),
		assistant("assistant-2", "user-2", "stop"),
	];
	expect(deriveDiskAttentionCandidate(repeated)?.id).not.toBe(currentId);
});

test("interrupted fingerprints survive legacy normalization and key to the latest user turn", () => {
	const current = [user(), assistant("assistant-1", "user-1", "toolUse")];
	const currentCandidate = deriveDiskAttentionCandidate(current);
	expect(currentCandidate).toMatchObject({
		id: "interrupted:user-1",
		kind: "interrupted",
		turnId: "user-1",
	});
	const legacySource = current
		.map((entry) => {
			const { id: _id, parentId: _parentId, ...legacy } = entry;
			return JSON.stringify(legacy);
		})
		.join("\n");
	const legacyCandidate = deriveDiskAttentionCandidate(parseAttentionEntries(legacySource, false));
	expect(legacyCandidate?.id).toStartWith("legacy-interrupted:");
	expect(currentCandidate?.aliases).toContain(legacyCandidate?.id);
	const repeated = [...current, user("user-2", "assistant-1")];
	expect(deriveDiskAttentionCandidate(repeated)).toMatchObject({
		id: "interrupted:user-2",
		kind: "interrupted",
		turnId: "user-2",
	});
});

test("running and queued sessions stay quiet while aborted/toolUse/unfinished settle as interrupted", () => {
	const done = [user(), assistant("assistant-1", "user-1", "stop")];
	expect(deriveAttentionCandidate(inputs(done, { isStreaming: true }))).toBeNull();
	expect(deriveAttentionCandidate(inputs(done, { pendingMessageCount: 1 }))).toBeNull();
	expect(deriveDiskAttentionCandidate([user()])).toMatchObject({
		kind: "interrupted",
		turnId: "user-1",
	});
	for (const stopReason of ["aborted", "toolUse", "unfinished"] as const) {
		expect(
			deriveDiskAttentionCandidate([
				user(),
				assistant(`assistant-${stopReason}`, "user-1", stopReason),
			]),
		).toMatchObject({ kind: "interrupted", turnId: "user-1" });
	}
	expect(
		deriveDiskAttentionCandidate([user(), assistant("legacy-done", "user-1", undefined)]),
	).toBeNull();
});

test("a live review candidate requires an observed final settlement", () => {
	const entries = [user(), assistant("assistant-1", "user-1", "error")];
	expect(deriveAttentionCandidate(inputs(entries, { lastSettlement: null }))).toBeNull();
	const live = deriveAttentionCandidate(
		inputs(entries, { lastSettlement: { stopReason: "error" } }),
	);
	expect(live).toMatchObject({ kind: "review", turnId: "user-1" });
	expect(live?.id).toBe(deriveDiskAttentionCandidate(entries)?.id);
});

test("an explicit blocker outranks streaming and cannot be mistaken for review", () => {
	const entries = [user()];
	expect(
		deriveAttentionCandidate(inputs(entries, { isStreaming: true, pendingDialogId: "dialog-1" })),
	).toEqual({ id: "dialog:dialog-1", kind: "blocking", turnId: "user-1" });
});

test("an acknowledged questionnaire blocks first, then yields interrupted until a fresh terminal", () => {
	const awaiting = questionEntries();
	expect(deriveDiskAttentionCandidate(awaiting.slice(0, 2))).toMatchObject({
		kind: "interrupted",
		turnId: "user-1",
	});
	expect(deriveAttentionCandidate(inputs(awaiting, { isStreaming: true }))).toEqual({
		id: "question:tc-1",
		kind: "blocking",
		turnId: "user-1",
	});
	const answered: SessionEntry = {
		type: "custom_message",
		id: "answer-entry",
		parentId: "ack-entry",
		timestamp: "2026-01-01T00:00:03.000Z",
		customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
		content: "User answered",
		display: true,
		details: { toolCallId: "tc-1", result: { answers: [], cancelled: false } },
	};
	expect(deriveDiskAttentionCandidate([...awaiting, answered])).toMatchObject({
		kind: "interrupted",
		turnId: "user-1",
	});
	expect(deriveDiskAttentionCandidate([...awaiting, user("user-2", "ack-entry")])).toMatchObject({
		kind: "interrupted",
		turnId: "user-2",
	});
});

test("disk derivation follows the active parent branch, not abandoned physical messages", () => {
	const root = user();
	const abandoned = questionEntries().slice(1);
	const branch: SessionEntry = {
		type: "branch_summary",
		id: "branch-1",
		parentId: root.id,
		timestamp: "2026-01-01T00:00:04.000Z",
		fromId: "ack-entry",
		summary: "Changed direction",
	};
	const physical = [root, ...abandoned, branch];
	expect(deriveDiskAttentionCandidate(physical)).toMatchObject({
		kind: "interrupted",
		turnId: "user-1",
	});
	const completed = assistant("assistant-new", branch.id, "stop");
	const candidate = deriveDiskAttentionCandidate([...physical, completed]);
	expect(candidate).toMatchObject({ kind: "review", turnId: "user-1" });
	expect(candidate?.id).toStartWith("review:");
});

test("the transcript parser retains stable message and custom-message entry ids", () => {
	const entries = questionEntries();
	const answer: SessionEntry = {
		type: "custom_message",
		id: "answer-entry",
		parentId: "ack-entry",
		timestamp: "2026-01-01T00:00:03.000Z",
		customType: ASK_USER_ANSWERS_CUSTOM_TYPE,
		content: "User answered",
		display: true,
		details: { toolCallId: "tc-1", result: { answers: [], cancelled: false } },
	};
	const source = [
		JSON.stringify({ type: "session", id: "session-1" }),
		...entries.map((entry) => JSON.stringify(entry)),
		JSON.stringify(answer),
	].join("\n");
	expect(parseAttentionEntries(source, false).map((entry) => entry.id)).toEqual([
		"user-1",
		"ask-entry",
		"ack-entry",
		"answer-entry",
	]);
	expect(deriveDiskAttentionCandidate(parseAttentionEntries(source, false))).toMatchObject({
		kind: "interrupted",
		turnId: "user-1",
	});
});
