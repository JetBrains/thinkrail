import { expect, test } from "bun:test";
import { turnDivider } from "./turns";
import type { ChatTurn } from "./types";

function user(id: string, timestamp: number): ChatTurn {
	return { kind: "user", id, message: { role: "user", content: "hi", timestamp } } as ChatTurn;
}

function assistant(id: string, toolCalls: Array<{ name: string; path?: string }>): ChatTurn {
	return {
		kind: "assistant",
		id,
		streaming: false,
		message: {
			role: "assistant",
			content: toolCalls.map((tc, i) => ({
				type: "toolCall",
				id: `${id}-${i}`,
				name: tc.name,
				arguments: tc.path ? { path: tc.path } : {},
			})),
		},
	} as unknown as ChatTurn;
}

test("turnDivider is null before the first user turn (nothing to divide)", () => {
	expect(turnDivider([user("u1", 1000)], 0)).toBeNull();
});

test("turnDivider counts tools, collects only edit/write files, and measures elapsed", () => {
	const turns: ChatTurn[] = [
		user("u1", 1_000),
		assistant("a1", [
			{ name: "bash" },
			{ name: "write", path: "a.ts" },
			{ name: "edit", path: "a.ts" },
			{ name: "read", path: "b.ts" },
		]),
		user("u2", 73_000),
	];
	const d = turnDivider(turns, 2);
	expect(d?.toolCount).toBe(4);
	expect(d?.changedFiles).toEqual(["a.ts"]); // distinct; read is not a change
	expect(d?.elapsedMs).toBe(72_000);
});

test("turnDivider spans multiple assistant turns (system turns ignored) and dedupes files", () => {
	const turns: ChatTurn[] = [
		user("u1", 0),
		assistant("a1", [{ name: "write", path: "x.ts" }]),
		{ kind: "system", id: "s1", text: "✓ Done" } as ChatTurn,
		assistant("a2", [
			{ name: "edit", path: "x.ts" },
			{ name: "write", path: "y.ts" },
		]),
		user("u2", 5_000),
	];
	const d = turnDivider(turns, 4);
	expect(d?.toolCount).toBe(3);
	expect(d?.changedFiles).toEqual(["x.ts", "y.ts"]);
	expect(d?.elapsedMs).toBe(5_000);
});

test("turnDivider reports no changed files / zero tools for a plain Q&A round", () => {
	const turns: ChatTurn[] = [user("u1", 0), assistant("a1", []), user("u2", 2_000)];
	const d = turnDivider(turns, 2);
	expect(d?.toolCount).toBe(0);
	expect(d?.changedFiles).toEqual([]);
	expect(d?.elapsedMs).toBe(2_000);
});
