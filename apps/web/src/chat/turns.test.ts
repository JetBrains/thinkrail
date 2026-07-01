import { expect, test } from "bun:test";
import { turnDivider } from "./turns";
import type { ChatTurn } from "./types";

function user(id: string, timestamp: number): ChatTurn {
	return { kind: "user", id, message: { role: "user", content: "hi", timestamp } } as ChatTurn;
}

function assistant(
	id: string,
	toolCalls: Array<{ name: string; path?: string }>,
	timestamp = 0,
): ChatTurn {
	return {
		kind: "assistant",
		id,
		streaming: false,
		message: {
			role: "assistant",
			timestamp,
			content: toolCalls.map((tc, i) => ({
				type: "toolCall",
				id: `${id}-${i}`,
				name: tc.name,
				arguments: tc.path ? { path: tc.path } : {},
			})),
		},
	} as unknown as ChatTurn;
}

function done(id: string, endedAt: number): ChatTurn {
	return { kind: "system", id, text: "✓ Done", endedAt } as ChatTurn;
}

test("turnDivider is null with no user turn to open the round (nothing to summarize)", () => {
	expect(turnDivider([done("s1", 1000)], 0)).toBeNull();
});

test("turnDivider counts tools, collects only edit/write files, and measures user→end elapsed", () => {
	// Anchored at the round's "✓ Done" marker (index 2); elapsed = endedAt − user.timestamp.
	const turns: ChatTurn[] = [
		user("u1", 1_000),
		assistant("a1", [
			{ name: "bash" },
			{ name: "write", path: "a.ts" },
			{ name: "edit", path: "a.ts" },
			{ name: "read", path: "b.ts" },
		]),
		done("s1", 73_000),
	];
	const d = turnDivider(turns, 2);
	expect(d?.toolCount).toBe(4);
	expect(d?.changedFiles).toEqual(["a.ts"]); // distinct; read is not a change
	expect(d?.elapsedMs).toBe(72_000);
});

test("turnDivider spans multiple assistant turns in the round and dedupes files", () => {
	const turns: ChatTurn[] = [
		user("u1", 0),
		assistant("a1", [{ name: "write", path: "x.ts" }]),
		assistant("a2", [
			{ name: "edit", path: "x.ts" },
			{ name: "write", path: "y.ts" },
		]),
		done("s1", 5_000),
	];
	const d = turnDivider(turns, 3);
	expect(d?.toolCount).toBe(3);
	expect(d?.changedFiles).toEqual(["x.ts", "y.ts"]);
	expect(d?.elapsedMs).toBe(5_000);
});

test("turnDivider falls back to the last assistant timestamp when there is no ✓ Done marker (hydrated)", () => {
	// Hydrated rounds carry no web-local "✓ Done" marker; the end time comes from the assistant reply.
	const turns: ChatTurn[] = [
		user("u1", 1_000),
		assistant("a1", [{ name: "write", path: "x.ts" }], 6_000),
	];
	const d = turnDivider(turns, 1);
	expect(d?.toolCount).toBe(1);
	expect(d?.changedFiles).toEqual(["x.ts"]);
	expect(d?.elapsedMs).toBe(5_000);
});

test("turnDivider reports no changed files / zero tools for a plain Q&A round", () => {
	const turns: ChatTurn[] = [user("u1", 0), assistant("a1", [], 2_000), done("s1", 2_000)];
	const d = turnDivider(turns, 2);
	expect(d?.toolCount).toBe(0);
	expect(d?.changedFiles).toEqual([]);
	expect(d?.elapsedMs).toBe(2_000);
});
