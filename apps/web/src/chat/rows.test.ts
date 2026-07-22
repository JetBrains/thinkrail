import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@thinkrail/contracts";
import { deriveRows, turnDivider } from "./rows";
import { registerToolRenderer } from "./toolRegistry";
import type { ChatTurn, ToolResultState } from "./types";

// Prominence comes from the registry seam — register fakes here (module-global registry; unique names).
registerToolRenderer("primary-tool", () => null, { prominence: "primary" });
registerToolRenderer("bare-tool", () => null, { chrome: "bare" }); // bare implies primary

// ---- turn builders ----

type Block =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string }
	| { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

function user(id: string, timestamp = 0): ChatTurn {
	return { kind: "user", id, message: { role: "user", content: "hi", timestamp } } as ChatTurn;
}

function assistant(
	id: string,
	blocks: Block[],
	opts: {
		streaming?: boolean;
		stopReason?: AssistantMessage["stopReason"];
		timestamp?: number;
	} = {},
): ChatTurn {
	return {
		kind: "assistant",
		id,
		streaming: opts.streaming ?? false,
		message: {
			role: "assistant",
			content: blocks,
			stopReason: opts.stopReason ?? "stop",
			timestamp: opts.timestamp ?? 0,
		},
	} as unknown as ChatTurn;
}

function done(id: string, endedAt = 0): ChatTurn {
	return { kind: "system", id, text: "✓ Done", endedAt } as ChatTurn;
}

const tc = (id: string, name = "bash"): Block => ({ type: "toolCall", id, name, arguments: {} });
const think = (thinking: string): Block => ({ type: "thinking", thinking });
const text = (t: string): Block => ({ type: "text", text: t });

const kinds = (rows: ReturnType<typeof deriveRows>) => rows.map((r) => r.kind);

// ---- grouping ----

describe("deriveRows grouping", () => {
	test("merges contiguous routine steps ACROSS assistant-message boundaries into one activity run", () => {
		// pi emits one assistant message per tool round — the fold must span them.
		const turns = [
			user("u1"),
			assistant("a1", [think("plan"), tc("t1", "bash")]),
			assistant("a2", [tc("t2", "read"), tc("t3", "read")]),
			assistant("a3", [text("the answer")]),
			done("s1"),
		];
		const rows = deriveRows(turns, {}, false);
		// The "✓ Done" marker no longer emits its own row — it's merged into the divider's Done badge.
		expect(kinds(rows)).toEqual(["user", "activity", "markdown", "divider"]);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected activity row");
		expect(activity.steps.map((s) => s.id)).toEqual(["a1:thinking:0", "t1", "t2", "t3"]);
		// Row id = first step's id — stable while the trailing run accumulates steps.
		expect(activity.id).toBe("activity:a1:thinking:0");
	});

	test("non-empty text splits the run; empty/whitespace text and empty thinking do not", () => {
		const turns = [
			user("u1"),
			assistant("a1", [
				tc("t1"),
				text("  "), // whitespace-only — renders nothing, splits nothing
				think(""), // empty thinking — skipped
				tc("t2"),
				text("interim narration"), // non-empty — stays visible and splits the fold
				tc("t3"),
			]),
			done("s1"),
		];
		const rows = deriveRows(turns, {}, false);
		expect(kinds(rows)).toEqual(["user", "activity", "markdown", "activity", "divider"]);
		const first = rows[1];
		const second = rows[3];
		if (first?.kind !== "activity" || second?.kind !== "activity") throw new Error("bad rows");
		expect(first.steps.map((s) => s.id)).toEqual(["t1", "t2"]);
		expect(second.steps.map((s) => s.id)).toEqual(["t3"]);
	});

	test("a primary tool escapes the fold as its own row and breaks the run (bare implies primary)", () => {
		const turns = [
			user("u1"),
			assistant("a1", [tc("t1"), tc("v1", "primary-tool"), tc("t2"), tc("q1", "bare-tool")]),
			done("s1"),
		];
		const rows = deriveRows(turns, {}, false);
		expect(kinds(rows)).toEqual(["user", "activity", "tool", "activity", "tool", "divider"]);
		const primary = rows[2];
		if (primary?.kind !== "tool") throw new Error("expected tool row");
		expect(primary.toolCallId).toBe("v1");
		expect(rows[4]?.id).toBe("q1");
	});

	test("a system notice WITHOUT endedAt still maps 1:1 (only the ✓ Done marker is merged away)", () => {
		const turns: ChatTurn[] = [
			user("u1"),
			{ kind: "system", id: "sys1", text: "Context compacted" },
			assistant("a1", [tc("t1")]),
			done("s1"),
		];
		const rows = deriveRows(turns, {}, false);
		// The plain notice renders; the "✓ Done" marker does not (merged into the divider).
		expect(kinds(rows)).toEqual(["user", "system", "activity", "divider"]);
	});

	test("non-assistant turns (user/system/error/retry) break runs and map 1:1", () => {
		const turns: ChatTurn[] = [
			user("u1"),
			assistant("a1", [tc("t1")]),
			{ kind: "error", id: "e1", text: "boom" },
			{ kind: "retry", id: "r1", attempt: 1, maxAttempts: 3, delayMs: 500 },
			assistant("a2", [tc("t2")]),
		];
		const rows = deriveRows(turns, {}, true);
		expect(kinds(rows)).toEqual(["user", "activity", "error", "retry", "activity"]);
		expect(rows[1]?.kind === "activity" && rows[1].steps.length).toBe(1);
		expect(rows[4]?.kind === "activity" && rows[4].steps.length).toBe(1);
	});

	test("steps carry dead from the owning message's stopReason (aborted calls never execute)", () => {
		const turns = [
			user("u1"),
			assistant("a1", [tc("t1")]), // completed round
			assistant("a2", [tc("t2")], { stopReason: "aborted" }),
		];
		const rows = deriveRows(turns, {}, false);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected activity row");
		const [s1, s2] = activity.steps;
		expect(s1?.kind === "tool" && s1.dead).toBe(false);
		expect(s2?.kind === "tool" && s2.dead).toBe(true);
	});

	test("pairs each tool step with its result state by toolCallId", () => {
		const results: Record<string, ToolResultState> = {
			t1: { status: "done", raw: "ok" },
			t2: { status: "error", raw: "bad" },
		};
		const rows = deriveRows(
			[user("u1"), assistant("a1", [tc("t1"), tc("t2"), tc("t3")])],
			results,
			true,
		);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected activity row");
		const [s1, s2, s3] = activity.steps;
		expect(s1?.kind === "tool" && s1.tool?.status).toBe("done");
		expect(s2?.kind === "tool" && s2.tool?.status).toBe("error");
		expect(s3?.kind === "tool" && s3.tool).toBeUndefined();
	});
});

// ---- streaming / live ----

describe("deriveRows live trailing run", () => {
	test("the trailing run of a streaming transcript is live", () => {
		const turns = [user("u1"), assistant("a1", [think("hmm"), tc("t1")], { streaming: true })];
		const rows = deriveRows(turns, {}, true);
		const last = rows[rows.length - 1];
		if (last?.kind !== "activity") throw new Error("expected trailing activity row");
		expect(last.live).toBe(true);
		expect(last.steps.every((s) => s.streaming)).toBe(true);
	});

	test("the run stops being live the moment answer text starts (auto-collapse trigger)", () => {
		const turns = [
			user("u1"),
			assistant("a1", [think("hmm"), tc("t1"), text("The answer is")], { streaming: true }),
		];
		const rows = deriveRows(turns, {}, true);
		expect(kinds(rows)).toEqual(["user", "activity", "markdown"]);
		expect(rows[1]?.kind === "activity" && rows[1].live).toBe(false);
	});

	test("a finished transcript has no live run (aborted mid-run folds plainly)", () => {
		const turns = [user("u1"), assistant("a1", [tc("t1")], { stopReason: "aborted" })];
		const rows = deriveRows(turns, {}, false);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected activity row");
		expect(activity.live).toBe(false);
	});

	test("a run broken by a mid-round user boundary is never live even while streaming", () => {
		// A completed earlier round stays folded while a new turn streams.
		const turns = [
			user("u1"),
			assistant("a1", [tc("t1")]),
			done("s1"),
			user("u2"),
			assistant("a2", [tc("t2")], { streaming: true }),
		];
		const rows = deriveRows(turns, {}, true);
		expect(kinds(rows)).toEqual(["user", "activity", "divider", "user", "activity"]);
		expect(rows[1]?.kind === "activity" && rows[1].live).toBe(false);
		expect(rows[4]?.kind === "activity" && rows[4].live).toBe(true);
	});

	test("row and step ids are stable across streaming snapshots (fold-state keys)", () => {
		const early = deriveRows(
			[user("u1"), assistant("a1", [think("h"), tc("t1")], { streaming: true })],
			{},
			true,
		);
		const late = deriveRows(
			[
				user("u1"),
				assistant("a1", [think("hmm more"), tc("t1"), tc("t2")], { streaming: false }),
				assistant("a2", [tc("t3")], { streaming: true }),
			],
			{},
			true,
		);
		const a1 = early[1];
		const a2 = late[1];
		if (a1?.kind !== "activity" || a2?.kind !== "activity") throw new Error("bad rows");
		expect(a2.id).toBe(a1.id);
		expect(a2.steps.slice(0, 2).map((s) => s.id)).toEqual(a1.steps.map((s) => s.id));
	});
});

// ---- dividers (the turnDivider deriver, folded behind deriveRows) ----

describe("deriveRows dividers", () => {
	test("a divider row closes the round at its ✓ Done marker (not at the next user turn)", () => {
		const turns = [user("u1", 1_000), assistant("a1", [tc("t1", "write")]), done("s1", 3_000)];
		const rows = deriveRows(turns, {}, false);
		expect(kinds(rows)).toEqual(["user", "activity", "divider"]);
		const divider = rows[2];
		if (divider?.kind !== "divider") throw new Error("expected divider row");
		expect(divider.data.toolCount).toBe(1);
		expect(divider.id).toBe("s1:divider");
	});

	test("no divider while the round still streams", () => {
		const rows = deriveRows(
			[user("u1"), assistant("a1", [text("answering…")], { streaming: true })],
			{},
			true,
		);
		expect(kinds(rows)).toEqual(["user", "markdown"]);
	});
});

// ---- turnDivider (moved from turns.test.ts — the deriver itself) ----

function assistantWithPaths(
	id: string,
	toolCalls: Array<{ name: string; path?: string }>,
	timestamp = 0,
): ChatTurn {
	return assistant(
		id,
		toolCalls.map((t, i) => ({
			type: "toolCall",
			id: `${id}-${i}`,
			name: t.name,
			arguments: t.path ? { path: t.path } : {},
		})),
		{ timestamp },
	);
}

test("turnDivider is null with no user turn to open the round (nothing to summarize)", () => {
	expect(turnDivider([done("s1", 1000)], 0)).toBeNull();
});

test("turnDivider counts tools, collects only edit/write files, and measures user→end elapsed", () => {
	// Anchored at the round's "✓ Done" marker (index 2); elapsed = endedAt − user.timestamp.
	const turns: ChatTurn[] = [
		user("u1", 1_000),
		assistantWithPaths("a1", [
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
		assistantWithPaths("a1", [{ name: "write", path: "x.ts" }]),
		assistantWithPaths("a2", [
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
		assistantWithPaths("a1", [{ name: "write", path: "x.ts" }], 6_000),
	];
	const d = turnDivider(turns, 1);
	expect(d?.toolCount).toBe(1);
	expect(d?.changedFiles).toEqual(["x.ts"]);
	expect(d?.elapsedMs).toBe(5_000);
});

test("turnDivider reports no changed files / zero tools for a plain Q&A round", () => {
	const turns: ChatTurn[] = [user("u1", 0), assistantWithPaths("a1", [], 2_000), done("s1", 2_000)];
	const d = turnDivider(turns, 2);
	expect(d?.toolCount).toBe(0);
	expect(d?.changedFiles).toEqual([]);
	expect(d?.elapsedMs).toBe(2_000);
});
