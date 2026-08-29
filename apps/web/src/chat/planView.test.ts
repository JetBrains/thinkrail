import { expect, test } from "bun:test";
import type { AssistantMessage, TodoGroupItem, TodoItem } from "@thinkrail/contracts";
import type { AskState } from "./askState";
import {
	flatItems,
	groupProgress,
	itemChangeSet,
	itemOpenFindings,
	itemRevisions,
	planCompletionSummary,
	planGlance,
	planSections,
	planSummary,
	reviewableItems,
	reviewChangesRequested,
	reviewProgress,
	sessionGlance,
	shouldNudgeOnAdd,
	stripStatus,
	verificationStatus,
} from "./planView";
import type { ChatTurn } from "./types";

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

test("stripStatus reflects the agent's state, not the checkboxes", () => {
	const current = item("a", "in_progress");
	const active = { done: 1, total: 3, current };
	const allDone = { done: 3, total: 3, current: undefined };
	const openIdle = { done: 1, total: 3, current: undefined };

	expect(stripStatus("working", active)).toEqual({ show: true, showLabel: false, title: "a" });
	expect(stripStatus("working", allDone)).toEqual({ show: true, showLabel: true });

	expect(stripStatus("waiting_question", allDone)).toEqual({ show: true, showLabel: true });
	expect(stripStatus("waiting_question", active)).toEqual({
		show: true,
		showLabel: true,
		title: "a",
	});

	expect(stripStatus("waiting", openIdle)).toEqual({ show: true, showLabel: true });
	expect(stripStatus("waiting", allDone)).toEqual({ show: false, showLabel: true });
});

test("planSummary spans loose + groups and surfaces the current step", () => {
	const summary = planSummary({
		todos: [item("loose", "done")],
		groups: [group("t", [item("a", "in_progress"), item("b")])],
	});
	expect(summary).toMatchObject({ done: 1, total: 3 });
	expect(summary.current?.title).toBe("a");
});

const asked = (answered: boolean, superseded = false): AskState => ({
	...(answered ? { answer: { answers: [], cancelled: false } } : {}),
	superseded,
});

test("planGlance: streaming wins; an awaiting question beats plain waiting", () => {
	expect(planGlance(true, {})).toBe("working");
	expect(planGlance(true, { q1: asked(false) })).toBe("working");
	expect(planGlance(false, {})).toBe("waiting");
	expect(planGlance(false, { q1: asked(false) })).toBe("waiting_question");
	expect(planGlance(false, { q1: asked(true) })).toBe("waiting");
	expect(planGlance(false, { q1: asked(false, true) })).toBe("waiting");
});

test("shouldNudgeOnAdd: never wake an agent waiting on a question; wake it otherwise", () => {
	expect(shouldNudgeOnAdd("waiting_question")).toBe(false);
	expect(shouldNudgeOnAdd("working")).toBe(true);
	expect(shouldNudgeOnAdd("waiting")).toBe(true);
});

test("sessionGlance derives the glance straight from a runtime (deriveAskStates + planGlance)", () => {
	const askTurn: ChatTurn = {
		kind: "assistant",
		id: "a1",
		streaming: false,
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "q1", name: "ask_user_question", arguments: {} }],
		} as unknown as AssistantMessage,
	};
	expect(sessionGlance({ isStreaming: true, turns: [askTurn], askAnswers: {} })).toBe("working");
	expect(sessionGlance({ isStreaming: false, turns: [askTurn], askAnswers: {} })).toBe(
		"waiting_question",
	);
	expect(sessionGlance({ isStreaming: false, turns: [], askAnswers: {} })).toBe("waiting");
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

test("planCompletionSummary shows only while every item is done", () => {
	const done = { todos: [item("a", "done")], groups: [], summary: "All landed." };
	expect(planCompletionSummary(done)).toBe("All landed.");
	// A re-opened plan (open items) hides the stale note; an empty plan never shows one.
	expect(planCompletionSummary({ ...done, todos: [item("a", "done"), item("b")] })).toBeUndefined();
	expect(planCompletionSummary({ todos: [], groups: [], summary: "x" })).toBeUndefined();
	expect(planCompletionSummary({ todos: [item("a", "done")], groups: [] })).toBeUndefined();
});

test("verificationStatus: an honest 'not verified' reads unverified; a named check reads claimed", () => {
	expect(verificationStatus("bun test src/todos — 34 pass")).toBe("claimed");
	expect(verificationStatus("typecheck green")).toBe("claimed");
	expect(verificationStatus("not verified")).toBe("unverified");
	expect(verificationStatus("Not Verified — ran out of budget")).toBe("unverified");
	expect(verificationStatus("unverified")).toBe("unverified");
	expect(verificationStatus("no verification performed")).toBe("unverified");
});
