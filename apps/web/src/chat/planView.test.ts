import { beforeAll, expect, test } from "bun:test";
import type { AssistantMessage, TodoGroupItem, TodoItem, UserMessage } from "@thinkrail/contracts";
import type { InteractionState } from "./interactionState";
import {
	adoptedCommits,
	flatItems,
	groupProgress,
	hostSessionGlance,
	isPlanReady,
	itemChangeSet,
	itemOpenFindings,
	itemRevisions,
	pendingInteraction,
	planChangeTotals,
	planCompletionSummary,
	planGlance,
	planSections,
	planStaleSummary,
	planSummary,
	reviewableItems,
	reviewChangesRequested,
	reviewProgress,
	sessionGlance,
	shouldNudgeOnAdd,
	verificationStatus,
} from "./planView";
import { registerToolRenderer } from "./toolRegistry";
import type { ChatTurn } from "./types";

// Transcript-derived glances only see calls whose web renderer registered as interactive; stand in for
// the real ask-user-question card with an inert one.
beforeAll(() => {
	registerToolRenderer("ask_user_question", () => null, { interactive: true });
});

const item = (title: string, status: TodoItem["status"] = "pending"): TodoItem => ({
	id: `t_${title}`,
	title,
	status,
	origin: "agent",
	createdAt: "",
	updatedAt: "",
});

const group = (
	title: string,
	todos: TodoItem[],
	status: TodoGroupItem["status"] = "pending",
): TodoGroupItem => ({
	id: `g_${title}`,
	title,
	todos,
	status,
});

test("groupProgress counts done/total for the header badge", () => {
	expect(groupProgress(group("t", [item("a", "done"), item("b", "in_progress")]))).toEqual({
		done: 1,
		total: 2,
	});
});

test("flatItems orders the groups first, the loose lane (user adds) last", () => {
	expect(
		flatItems({
			todos: [item("loose")],
			groups: [group("t", [item("a"), item("b")])],
		}).map((t) => t.title),
	).toEqual(["a", "b", "loose"]);
});

test("planSections buckets groups by the host-derived status and loose items by their own status", () => {
	const sections = planSections({
		todos: [item("loose-todo"), item("loose-done", "done")],
		groups: [
			group("Active", [item("a", "in_progress"), item("b")], "active"),
			group("Pending", [item("c"), item("d", "done")]),
			group("Finished", [item("e", "done")], "done"),
		],
	});
	expect(sections.activeGroups.map((g) => g.title)).toEqual(["Active"]);
	expect(sections.pendingGroups.map((g) => g.title)).toEqual(["Pending"]);
	expect(sections.doneGroups.map((g) => g.title)).toEqual(["Finished"]);
	expect(sections.pendingLoose.map((t) => t.title)).toEqual(["loose-todo"]);
	expect(sections.doneLoose.map((t) => t.title)).toEqual(["loose-done"]);
	expect(sections.activeLoose).toEqual([]);
});

test("planSummary spans loose + groups and surfaces the current step", () => {
	const summary = planSummary({
		todos: [item("loose", "done")],
		groups: [group("t", [item("a", "in_progress"), item("b")])],
	});
	expect(summary).toMatchObject({ done: 1, total: 3 });
	expect(summary.current?.title).toBe("a");
});

const asked = (responded: boolean, superseded = false, terminal = false): InteractionState => ({
	...(responded ? { response: { answers: [], cancelled: false } } : {}),
	superseded,
	terminal,
});

test("planGlance: an awaiting interaction wins even while its live tool blocks the run", () => {
	expect(planGlance(true, {})).toBe("working");
	expect(planGlance(true, { q1: asked(false) })).toBe("waiting_question");
	expect(planGlance(false, {})).toBe("waiting");
	expect(planGlance(false, { q1: asked(false) })).toBe("waiting_question");
	expect(planGlance(false, { q1: asked(true) })).toBe("waiting");
	expect(planGlance(false, { q1: asked(false, true) })).toBe("waiting");
	expect(planGlance(false, { q1: asked(false, false, true) })).toBe("waiting");
});

test("hostSessionGlance uses host blockers and execution over stale transcript fallback", () => {
	const base = {
		execution: "running" as const,
		runId: "run-1",
		needsInput: null,
		completion: null,
		completionUnread: false,
		queuedCount: 0,
		backgroundWork: false,
	};
	expect(hostSessionGlance(base, "waiting_question")).toBe("working");
	expect(hostSessionGlance({ ...base, execution: "idle" }, "working")).toBe("waiting");
	expect(hostSessionGlance({ ...base, execution: "idle", backgroundWork: true }, "waiting")).toBe(
		"working",
	);
	expect(
		hostSessionGlance(
			{
				...base,
				needsInput: {
					interactionId: "dialog:d1",
					kind: "dialog",
					request: {
						id: "d1",
						sessionId: "s1",
						kind: "confirm",
						title: "Continue?",
						message: "Proceed?",
					},
				},
			},
			"working",
		),
	).toBe("waiting_question");
	expect(hostSessionGlance(null, "waiting_question")).toBe("waiting_question");
});

test("shouldNudgeOnAdd: never wake an agent waiting on a question; wake it otherwise", () => {
	expect(shouldNudgeOnAdd("waiting_question")).toBe(false);
	expect(shouldNudgeOnAdd("working")).toBe(true);
	expect(shouldNudgeOnAdd("waiting")).toBe(true);
});

const askTurn = (
	id: string,
	toolCallId: string,
	args: Record<string, unknown> = {},
	streaming = false,
): ChatTurn => ({
	kind: "assistant",
	id,
	streaming,
	message: {
		role: "assistant",
		content: [{ type: "toolCall", id: toolCallId, name: "ask_user_question", arguments: args }],
	} as unknown as AssistantMessage,
});

test("sessionGlance prefers host state and falls back to the runtime transcript (deriveInteractionStates + planGlance)", () => {
	const turns = [askTurn("a1", "q1")];
	expect(sessionGlance({ isStreaming: true, turns, toolResponses: {}, toolResults: {} })).toBe(
		"waiting_question",
	);
	expect(sessionGlance({ isStreaming: false, turns, toolResponses: {}, toolResults: {} })).toBe(
		"waiting_question",
	);
	expect(sessionGlance({ isStreaming: false, turns: [], toolResponses: {}, toolResults: {} })).toBe(
		"waiting",
	);
	expect(
		sessionGlance({
			isStreaming: false,
			turns,
			toolResponses: {},
			toolResults: { q1: { status: "error", raw: {} } },
		}),
	).toBe("waiting");
	expect(
		sessionGlance({
			isStreaming: false,
			turns: [],
			toolResponses: {},
			toolResults: {},
			hostState: {
				execution: "idle",
				runId: "run-1",
				needsInput: null,
				completion: { completionId: "completion:a1", outcome: "succeeded" },
				completionUnread: false,
				queuedCount: 0,
				backgroundWork: true,
			},
		}),
	).toBe("working");
});

test("sessionGlance recomputes when any input changes identity under the same turns array", () => {
	const turns: ChatTurn[] = [askTurn("a1", "q1")];
	const pending = { isStreaming: false, turns, toolResponses: {}, toolResults: {} };
	expect(sessionGlance(pending)).toBe("waiting_question");
	expect(sessionGlance({ ...pending, toolResults: { q1: { status: "error", raw: {} } } })).toBe(
		"waiting",
	);
	expect(
		sessionGlance({ ...pending, toolResponses: { q1: { answers: [], cancelled: false } } }),
	).toBe("waiting");
	expect(sessionGlance(pending)).toBe("waiting_question");
	expect(sessionGlance({ ...pending, turns: [] })).toBe("waiting");
});

test("pendingInteraction reconstructs the latest awaiting interactive call as render props, by tool name", () => {
	const userTurn: ChatTurn = {
		kind: "user",
		id: "u1",
		message: { role: "user", content: "hi", timestamp: 0 } as UserMessage,
	};
	const bashTurn: ChatTurn = {
		kind: "assistant",
		id: "b",
		streaming: false,
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "b1", name: "bash", arguments: { command: "ls" } }],
		} as unknown as AssistantMessage,
	};
	const first = askTurn("a1", "q1", { questions: [{ question: "First?" }] });
	const second = askTurn("a2", "q2", { questions: [{ question: "Second?" }] }, true);

	expect(pendingInteraction({ turns: [], toolResponses: {}, toolResults: {} })).toBeUndefined();
	// A non-interactive call never qualifies, whatever its state.
	expect(
		pendingInteraction({ turns: [bashTurn], toolResponses: {}, toolResults: {} }),
	).toBeUndefined();

	// Latest wins; the host's ack result rides along as the card's `result`.
	expect(
		pendingInteraction({
			turns: [first, bashTurn, second],
			toolResponses: {},
			toolResults: { q2: { status: "done", raw: { details: { kind: "ack" } } } },
		}),
	).toEqual({
		toolCallId: "q2",
		toolName: "ask_user_question",
		args: { questions: [{ question: "Second?" }] },
		result: { details: { kind: "ack" } },
		status: "done",
		streaming: true,
	});
	// Without a result the call reads as still running.
	expect(pendingInteraction({ turns: [first], toolResponses: {}, toolResults: {} })).toMatchObject({
		toolCallId: "q1",
		result: undefined,
		status: "running",
		streaming: false,
	});

	// A responded, superseded, or terminal call drops out — earlier awaiting ones still surface.
	expect(
		pendingInteraction({
			turns: [first, second],
			toolResponses: { q2: { answers: [], cancelled: false } },
			toolResults: {},
		})?.toolCallId,
	).toBe("q1");
	expect(
		pendingInteraction({ turns: [first, userTurn], toolResponses: {}, toolResults: {} }),
	).toBeUndefined();
	expect(
		pendingInteraction({
			turns: [first],
			toolResponses: {},
			toolResults: { q1: { status: "error", raw: {} } },
		}),
	).toBeUndefined();
});

test("itemChangeSet: the LATEST resolvable commit wins; live change paths (a fallback redo) win over commits", () => {
	const done: TodoItem = {
		...item("step", "done"),
		artifacts: [
			{ kind: "spec", path: "SPEC.md", specId: "s1" },
			{
				kind: "commit",
				sha: "abc123",
				files: [{ path: "a.ts", status: "modified", added: 2, removed: 1 }],
			},
			// A second fix-cycle commit — revisions accumulate; the newest resolvable one is "the" change set.
			{
				kind: "commit",
				sha: "def456",
				files: [{ path: "b.ts", status: "added", added: 5 }],
			},
		],
	};
	expect(itemChangeSet(done)).toEqual({
		kind: "commit",
		sha: "def456",
		files: [{ path: "b.ts", status: "added", added: 5 }],
	});
	// A redo that could NOT commit keeps its commit history but attaches live `change` paths — those are
	// the item's latest delta, so they win over the (older) commits.
	const fallbackRedo: TodoItem = {
		...done,
		artifacts: [...(done.artifacts ?? []), { kind: "change", path: "c.ts" }],
	};
	expect(itemChangeSet(fallbackRedo)).toEqual({ kind: "paths", paths: ["c.ts"] });
	// An unresolvable newest sha (no files) degrades to the previous resolvable revision.
	const gcd: TodoItem = {
		...item("step", "done"),
		artifacts: [
			{
				kind: "commit",
				sha: "abc123",
				files: [{ path: "a.ts", status: "modified", added: 2, removed: 1 }],
			},
			{ kind: "commit", sha: "gone000" },
		],
	};
	expect(itemChangeSet(gcd)).toEqual({
		kind: "commit",
		sha: "abc123",
		files: [{ path: "a.ts", status: "modified", added: 2, removed: 1 }],
	});
});

test("itemChangeSet: a commit without decorated files (unresolvable sha) degrades to null — no affordance", () => {
	const done: TodoItem = {
		...item("step", "done"),
		artifacts: [{ kind: "commit", sha: "deadbeef" }],
	};
	expect(itemChangeSet(done)).toBeNull();
});

test("itemChangeSet: change rows alone are the paths fallback; file/spec alone are nothing", () => {
	const fallback: TodoItem = {
		...item("step", "done"),
		artifacts: [
			{ kind: "change", path: "a.ts" },
			{ kind: "change", path: "b.ts" },
		],
	};
	expect(itemChangeSet(fallback)).toEqual({ kind: "paths", paths: ["a.ts", "b.ts"] });
	const agentOnly: TodoItem = {
		...item("doc", "done"),
		artifacts: [{ kind: "file", path: "README.md" }],
	};
	expect(itemChangeSet(agentOnly)).toBeNull();
	expect(itemChangeSet(item("bare", "done"))).toBeNull();
});

test("itemRevisions lists the commit history in order; review derivations follow the host decoration", () => {
	const reviewable: TodoItem = {
		...item("step", "done"),
		artifacts: [
			{ kind: "commit", sha: "abc123" },
			{ kind: "commit", sha: "def456" },
		],
		review: { state: "unreviewed", revision: 2 },
	};
	expect(itemRevisions(reviewable).map((r) => r.sha)).toEqual(["abc123", "def456"]);
	const research = item("research", "done"); // no review decoration → not reviewable
	const approved: TodoItem = {
		...item("approved", "done"),
		artifacts: [{ kind: "commit", sha: "aaa" }],
		review: { state: "reviewed", revision: 1, at: "2026-01-01T00:00:00Z" },
	};
	const plan = { todos: [reviewable, research, approved], groups: [] };
	expect(reviewableItems(plan).map((t) => t.id)).toEqual([reviewable.id, approved.id]);
	expect(reviewProgress(plan)).toEqual({ reviewed: 1, total: 2 });
});

test("isPlanReady is false while a reviewable step is unsettled, true once all are reviewed", () => {
	const done: TodoItem = {
		...item("step", "done"),
		artifacts: [{ kind: "commit", sha: "abc" }],
		review: { state: "unreviewed", revision: 1 },
	};
	// Every step done, but the reviewable one is unsettled — the plan must NOT read ship-ready.
	expect(isPlanReady({ todos: [done], groups: [] })).toBe(false);
	const reviewed: TodoItem = {
		...done,
		review: { state: "reviewed", revision: 1, at: "2026-01-01T00:00:00Z" },
	};
	expect(isPlanReady({ todos: [reviewed], groups: [] })).toBe(true);
	// An open step keeps it unready regardless of review state.
	expect(isPlanReady({ todos: [reviewed, item("pending")], groups: [] })).toBe(false);
	// An empty plan is not ready.
	expect(isPlanReady({ todos: [], groups: [] })).toBe(false);
});

test("reviewableItems spans adoptedCommits, but planSummary's build count counts planned items only", () => {
	const planned: TodoItem = {
		...item("planned", "done"),
		artifacts: [{ kind: "commit", sha: "abc" }],
		review: { state: "unreviewed", revision: 1 },
	};
	const adopted: TodoItem = {
		...item("loose", "done"),
		id: "commit:def456",
		origin: "adopted",
		artifacts: [{ kind: "commit", sha: "def456" }],
		review: { state: "unreviewed", revision: 1 },
	};
	const plan = { todos: [planned], groups: [], adoptedCommits: [adopted] };
	expect(adoptedCommits(plan).map((t) => t.id)).toEqual(["commit:def456"]);
	expect(reviewableItems(plan).map((t) => t.id)).toEqual([planned.id, "commit:def456"]);
	expect(planSummary(plan)).toEqual({ done: 1, total: 1, current: undefined });
});

test("itemOpenFindings: counts open agent comments anchored in the item's change set; reviewChangesRequested reads the verdict", () => {
	const flagged: TodoItem = {
		...item("flagged", "done"),
		artifacts: [{ kind: "commit", sha: "abc", files: [{ path: "src/a.ts", status: "modified" }] }],
		review: { state: "changes_requested", revision: 1, feedback: "fix it" },
	};
	const c = (over: { author?: "agent"; status: "draft" | "sent" | "resolved"; path?: string }) => ({
		author: over.author,
		status: over.status,
		anchor: over.path ? { path: over.path, side: "worktree" as const, selectors: [] } : null,
	});
	expect(
		itemOpenFindings(flagged, [
			c({ author: "agent", status: "draft", path: "src/a.ts" }), // counts
			c({ author: "agent", status: "sent", path: "src/a.ts" }), // counts (still open)
			c({ author: "agent", status: "resolved", path: "src/a.ts" }), // settled
			c({ author: "agent", status: "draft", path: "other.ts" }), // another change set
			c({ status: "draft", path: "src/a.ts" }), // the user's own draft
		]),
	).toBe(2);
	expect(itemOpenFindings(flagged, undefined)).toBe(0);
	expect(itemOpenFindings(item("no-set", "done"), [])).toBe(0);
	// Origin provenance wins over path overlap: same file, another step's finding never counts here.
	const stamped = (todoId: string, sessionId: string) => ({
		author: "agent" as const,
		status: "draft" as const,
		anchor: { path: "src/a.ts", side: "worktree" as const, selectors: [] },
		origin: { todoId, sessionId, reviewedSha: "abc" },
	});
	expect(
		itemOpenFindings(flagged, [stamped("t_flagged", "s1"), stamped("t_other", "s1")], "s1"),
	).toBe(1);
	expect(itemOpenFindings(flagged, [stamped("t_flagged", "s2")], "s1")).toBe(0);
	expect(reviewChangesRequested(flagged)).toBe(true);
	expect(reviewChangesRequested(item("plain", "done"))).toBe(false);
});

test("planChangeTotals counts distinct files across the whole plan, deduped by path", () => {
	const withCommit = (title: string, sha: string, paths: string[]): TodoItem => ({
		...item(title, "done"),
		artifacts: [
			{ kind: "commit", sha, files: paths.map((path) => ({ path, status: "modified" })) },
		],
	});
	const plan = {
		groups: [group("g", [withCommit("a", "sha1", ["src/x.ts", "src/y.ts"])], "done")],
		todos: [withCommit("b", "sha2", ["src/y.ts", "src/z.ts"])],
	};
	// x, y, z — y is shared across two steps and counts once.
	expect(planChangeTotals(plan).files).toBe(3);
	expect(planChangeTotals({ groups: [], todos: [] }).files).toBe(0);
});

test("planCompletionSummary shows only while every item is done", () => {
	const done = { todos: [item("a", "done")], groups: [], summary: "All landed." };
	expect(planCompletionSummary(done)).toBe("All landed.");
	// A re-opened plan (open items) hides the stale note; an empty plan never shows one.
	expect(planCompletionSummary({ ...done, todos: [item("a", "done"), item("b")] })).toBeUndefined();
	expect(planCompletionSummary({ todos: [], groups: [], summary: "x" })).toBeUndefined();
	expect(planCompletionSummary({ todos: [item("a", "done")], groups: [] })).toBeUndefined();
});

test("planStaleSummary keeps the stored note visible only once a completed plan re-opens", () => {
	const done = { todos: [item("a", "done")], groups: [], summary: "All landed." };
	// All-done is the fresh case (planCompletionSummary owns it), so no stale note.
	expect(planStaleSummary(done)).toBeUndefined();
	// A re-opened plan surfaces the stored note as stale.
	expect(planStaleSummary({ ...done, todos: [item("a", "done"), item("b")] })).toBe("All landed.");
	// No stored summary, or an empty plan, never shows one.
	expect(planStaleSummary({ todos: [item("a")], groups: [] })).toBeUndefined();
	expect(planStaleSummary({ todos: [], groups: [], summary: "x" })).toBeUndefined();
});

test("verificationStatus: an honest 'not verified' reads unverified; a named check reads claimed", () => {
	expect(verificationStatus("bun test src/todos — 34 pass")).toBe("claimed");
	expect(verificationStatus("typecheck green")).toBe("claimed");
	expect(verificationStatus("not verified")).toBe("unverified");
	expect(verificationStatus("Not Verified — ran out of budget")).toBe("unverified");
	expect(verificationStatus("unverified")).toBe("unverified");
	expect(verificationStatus("no verification performed")).toBe("unverified");
});
