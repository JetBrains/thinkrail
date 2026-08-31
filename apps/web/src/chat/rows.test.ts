import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@thinkrail/contracts";
import { type ChatRow, deriveRows, projectRows, turnDivider } from "./rows";
import { registerToolRenderer } from "./toolRegistry";
import type { ChatTurn, ToolResultState } from "./types";

registerToolRenderer("primary-tool", () => null, { prominence: "primary" });
registerToolRenderer("bare-tool", () => null, { chrome: "bare" });

type Block =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string }
	| { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

function user(id: string, timestamp = 0): ChatTurn {
	return { kind: "user", id, message: { role: "user", content: "hi", timestamp } } as ChatTurn;
}

function userWithAttachment(id: string, names: string[]): ChatTurn {
	return {
		kind: "user",
		id,
		message: {
			role: "user",
			content: [
				{ type: "text", text: "hi" },
				...names.map(() => ({ type: "image" as const, data: "AA==", mimeType: "image/png" })),
			],
			timestamp: 0,
		},
		attachmentNames: names,
	} as ChatTurn;
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

function messageRow(id: string, kind: "user" | "markdown"): ChatRow {
	return kind === "user"
		? { kind, id, message: { role: "user", content: id, timestamp: 0 } }
		: { kind, id, text: id };
}

describe("projectRows message order", () => {
	test("newest-first reverses both request groups and their rows while keeping a prelude separate", () => {
		const rows: ChatRow[] = [
			{ kind: "system", id: "prelude", text: "connected" },
			messageRow("u1", "user"),
			messageRow("a1", "markdown"),
			{ kind: "system", id: "s1", text: "done" },
			messageRow("u2", "user"),
			messageRow("a2", "markdown"),
			{ kind: "system", id: "s2", text: "done" },
		];

		expect(projectRows(rows, "newest-first").map((row) => row.id)).toEqual([
			"s2",
			"a2",
			"u2",
			"s1",
			"a1",
			"u1",
			"prelude",
		]);
	});

	test("oldest-first preserves canonical row order and newest-first preserves row objects", () => {
		const activity: ChatRow = { kind: "activity", id: "work", steps: [], live: false };
		const rows: ChatRow[] = [messageRow("u1", "user"), activity];
		expect(projectRows(rows, "oldest-first")).toBe(rows);
		expect(projectRows(rows, "newest-first")).toEqual([activity, rows[0]]);
		expect(projectRows(rows, "newest-first")[0]).toBe(activity);
	});
});

describe("deriveRows grouping", () => {
	test("keeps one outer activity run and nests tools under the preceding thinking block", () => {
		const turns = [
			user("u1"),
			assistant("a1", [tc("t0", "read"), think("plan"), tc("t1", "bash")]),
			assistant("a2", [tc("t2", "read"), think("revise"), tc("t3", "edit")]),
			assistant("a3", [text("the answer")]),
			done("s1"),
		];
		const rows = deriveRows(turns, {}, false);
		expect(kinds(rows)).toEqual(["user", "activity", "markdown", "system", "divider"]);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected one activity row");
		expect(activity).toMatchObject({ id: "activity:t0", live: false });
		expect(activity.steps).toMatchObject([
			{ kind: "tool", id: "t0" },
			{
				kind: "thinking",
				id: "a1:thinking:1",
				text: "plan",
				tools: [{ id: "t1" }, { id: "t2" }],
			},
			{
				kind: "thinking",
				id: "a2:thinking:1",
				text: "revise",
				tools: [{ id: "t3" }],
			},
		]);
	});

	test("non-empty text splits the run; empty/whitespace text and empty thinking do not", () => {
		const turns = [
			user("u1"),
			assistant("a1", [
				tc("t1"),
				text("  "),
				think(""),
				tc("t2"),
				text("interim narration"),
				tc("t3"),
			]),
			done("s1"),
		];
		const rows = deriveRows(turns, {}, false);
		expect(kinds(rows)).toEqual(["user", "activity", "markdown", "activity", "system", "divider"]);
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
		expect(kinds(rows)).toEqual([
			"user",
			"activity",
			"tool",
			"activity",
			"tool",
			"system",
			"divider",
		]);
		const primary = rows[2];
		if (primary?.kind !== "tool") throw new Error("expected tool row");
		expect(primary.toolCallId).toBe("v1");
		expect(rows[4]?.id).toBe("q1");
	});

	test("a user turn's attachmentNames pass through to its row (echo-only; hydrated turns carry none)", () => {
		const rows = deriveRows([userWithAttachment("u1", ["shot.png"]), user("u2")], {}, false);
		expect(rows[0]?.kind === "user" ? rows[0].attachmentNames : null).toEqual(["shot.png"]);
		expect(rows[1]?.kind === "user" ? "attachmentNames" in rows[1] : null).toBe(false);
	});

	test("non-assistant turns (user/system/error/retry) break runs and map 1:1", () => {
		const turns: ChatTurn[] = [
			user("u1"),
			assistant("a1", [tc("t1")]),
			{ kind: "error", id: "e1", text: "boom", recovery: "try-again" },
			{
				kind: "retry",
				id: "r1",
				source: "summarization",
				attempt: 1,
				maxAttempts: 3,
				delayMs: 500,
			},
			assistant("a2", [tc("t2")]),
		];
		const rows = deriveRows(turns, {}, true);
		expect(kinds(rows)).toEqual(["user", "activity", "error", "retry", "activity"]);
		expect(rows[2]?.kind === "error" ? rows[2].recovery : undefined).toBe("try-again");
		expect(rows[3]?.kind === "retry" && rows[3].source).toBe("summarization");
		expect(rows[1]?.kind === "activity" && rows[1].steps.length).toBe(1);
		expect(rows[4]?.kind === "activity" && rows[4].steps.length).toBe(1);
	});

	test("a subagentCompletion turn breaks the run and maps 1:1 to its own row", () => {
		const details = {
			childSessionId: "child-1",
			roleName: "scout",
			task: "map",
			status: "completed",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
				turns: 1,
				contextTokens: 2,
			},
			durationMs: 1000,
		} as const;
		const turns: ChatTurn[] = [
			user("u1"),
			assistant("a1", [tc("t1")]),
			{ kind: "subagentCompletion", id: "sc1", details, text: "the report" },
			assistant("a2", [tc("t2")]),
		];
		const rows = deriveRows(turns, {}, true);
		expect(kinds(rows)).toEqual(["user", "activity", "subagentCompletion", "activity"]);
		const row = rows[2];
		expect(row?.kind === "subagentCompletion" && row.details.childSessionId).toBe("child-1");
		expect(row?.kind === "subagentCompletion" && row.text).toBe("the report");
	});

	test("steps carry dead from the owning message's stopReason (aborted calls never execute)", () => {
		const turns = [
			user("u1"),
			assistant("a1", [tc("t1")]),
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

describe("deriveRows compaction notices", () => {
	test("a compaction turn maps 1:1 to its own row and breaks the activity run (never folded)", () => {
		const turns: ChatTurn[] = [
			user("u1"),
			assistant("a1", [tc("t1", "bash")]),
			{ kind: "compaction", id: "c1", status: "done", tokensBefore: 268_909, tokensAfter: 12_000 },
			assistant("a2", [tc("t2", "read")]),
			done("s1"),
		];
		const rows = deriveRows(turns, {}, false);
		expect(kinds(rows)).toEqual([
			"user",
			"activity",
			"compaction",
			"activity",
			"system",
			"divider",
		]);
		expect(rows[2]).toMatchObject({
			kind: "compaction",
			id: "c1",
			status: "done",
			tokensBefore: 268_909,
			tokensAfter: 12_000,
		});
	});

	test("a running compaction notice renders while the transcript streams (no dead air)", () => {
		const turns: ChatTurn[] = [
			user("u1"),
			assistant("a1", [], { stopReason: "length" }),
			{ kind: "compaction", id: "c1", status: "running" },
		];
		expect(kinds(deriveRows(turns, {}, true))).toEqual(["user", "compaction"]);
	});
});

describe("deriveRows live trailing run", () => {
	test("the one trailing outer activity run is live while its nested groups stay structural", () => {
		const turns = [
			user("u1"),
			assistant("a1", [think("first"), tc("t1"), think("second"), tc("t2")], {
				streaming: true,
			}),
		];
		const rows = deriveRows(turns, {}, true);
		expect(kinds(rows)).toEqual(["user", "activity"]);
		const activity = rows[1];
		if (activity?.kind !== "activity") throw new Error("expected activity row");
		expect(activity.live).toBe(true);
		expect(activity.steps.map((step) => step.kind)).toEqual(["thinking", "thinking"]);
		expect(
			activity.steps.every(
				(step) => step.kind === "thinking" && step.tools.every((tool) => tool.streaming),
			),
		).toBe(true);
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
		const turns = [
			user("u1"),
			assistant("a1", [tc("t1")]),
			done("s1"),
			user("u2"),
			assistant("a2", [tc("t2")], { streaming: true }),
		];
		const rows = deriveRows(turns, {}, true);
		expect(kinds(rows)).toEqual(["user", "activity", "system", "divider", "user", "activity"]);
		expect(rows[1]?.kind === "activity" && rows[1].live).toBe(false);
		expect(rows[5]?.kind === "activity" && rows[5].live).toBe(true);
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
		const firstEarly = a1.steps[0];
		const firstLate = a2.steps[0];
		if (firstEarly?.kind !== "thinking" || firstLate?.kind !== "thinking")
			throw new Error("expected nested thinking");
		expect(firstLate.id).toBe(firstEarly.id);
		expect(firstLate.tools.slice(0, 1).map((step) => step.id)).toEqual(
			firstEarly.tools.map((step) => step.id),
		);
	});
});

describe("deriveRows dividers", () => {
	test("a divider row closes the round at its ✓ Done marker (not at the next user turn)", () => {
		const turns = [user("u1", 1_000), assistant("a1", [tc("t1", "write")]), done("s1", 3_000)];
		const rows = deriveRows(turns, {}, false);
		expect(kinds(rows)).toEqual(["user", "activity", "system", "divider"]);
		const divider = rows[3];
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
	expect(d?.changedFiles).toEqual(["a.ts"]);
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
	expect(d?.specs).toEqual([]);
	expect(d?.changedFiles).toEqual([]);
	expect(d?.elapsedMs).toBe(2_000);
});

test("turnDivider splits specs from code changes via isSpec, each path on exactly one side", () => {
	const turns: ChatTurn[] = [
		user("u1", 0),
		assistantWithPaths("a1", [
			{ name: "write", path: "packages/pi-todos/SPEC.md" },
			{ name: "edit", path: "packages/pi-todos/core/store.ts" },
		]),
		done("s1", 5_000),
	];
	const d = turnDivider(turns, 2, (p) => p.endsWith("SPEC.md"));
	expect(d?.specs).toEqual(["packages/pi-todos/SPEC.md"]);
	expect(d?.changedFiles).toEqual(["packages/pi-todos/core/store.ts"]);
});

test("turnDivider counts a gitignored scratch spec as a spec, not as a (never-visible) change", () => {
	const path = ".thinkrail/context/TASK-todo-linear-groups.md";
	const turns: ChatTurn[] = [
		user("u1", 0),
		assistantWithPaths("a1", [
			{ name: "spec_create", path },
			{ name: "write", path },
			{ name: "edit", path },
		]),
		done("s1", 5_000),
	];
	const d = turnDivider(turns, 2, () => false);
	expect(d?.toolCount).toBe(3);
	expect(d?.specs).toEqual([path]);
	expect(d?.changedFiles).toEqual([]);
});

test("turnDivider lets the spec side win a tie — a path reached by both routes is never double-counted", () => {
	const path = "docs/SPEC.md";
	const turns: ChatTurn[] = [
		user("u1", 0),
		assistantWithPaths("a1", [
			{ name: "edit", path },
			{ name: "spec_create", path },
		]),
		done("s1", 5_000),
	];
	const d = turnDivider(turns, 2);
	expect(d?.specs).toEqual([path]);
	expect(d?.changedFiles).toEqual([]);
});

test("turnDivider treats every written file as a change when no classifier is supplied", () => {
	const turns: ChatTurn[] = [
		user("u1", 0),
		assistantWithPaths("a1", [{ name: "write", path: "SPEC.md" }]),
		done("s1", 5_000),
	];
	const d = turnDivider(turns, 2);
	expect(d?.specs).toEqual([]);
	expect(d?.changedFiles).toEqual(["SPEC.md"]);
});
