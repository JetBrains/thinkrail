import { expect, test } from "bun:test";
import type { AssistantMessage, TodoGroupItem, TodoItem } from "@thinkrail/contracts";
import type { AskState } from "./askState";
import {
	flatItems,
	groupProgress,
	itemChangeSet,
	planGlance,
	planSections,
	planSummary,
	sessionGlance,
	shouldNudgeOnAdd,
	stripStatus,
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

/** A group as the wire delivers it: `status` is host-derived (`pi-todos`' `groupStatus`, tested there). */
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
	expect(sections.pendingGroups.map((g) => g.title)).toEqual(["Pending"]); // stays whole, done step inline
	expect(sections.doneGroups.map((g) => g.title)).toEqual(["Finished"]);
	expect(sections.pendingLoose.map((t) => t.title)).toEqual(["loose-todo"]);
	expect(sections.doneLoose.map((t) => t.title)).toEqual(["loose-done"]);
	expect(sections.activeLoose).toEqual([]);
});

test("stripStatus reflects the agent's state, not the checkboxes", () => {
	const current = item("a", "in_progress");
	const active = { done: 1, total: 3, current };
	const allDone = { done: 3, total: 3, current: undefined };
	const openIdle = { done: 1, total: 3, current: undefined }; // open steps, none in_progress

	// working: always shown; label hidden when a current step's title carries it, shown when title-less.
	expect(stripStatus("working", active)).toEqual({ show: true, showLabel: false, title: "a" });
	expect(stripStatus("working", allDone)).toEqual({ show: true, showLabel: true });

	// waiting_question: shown even when everything is done — the reported bug.
	expect(stripStatus("waiting_question", allDone)).toEqual({ show: true, showLabel: true });
	expect(stripStatus("waiting_question", active)).toEqual({
		show: true,
		showLabel: true,
		title: "a",
	});

	// waiting (stopped, no question): 'Paused' only while open steps remain; clean finish shows nothing.
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
	expect(planGlance(false, { q1: asked(false, true) })).toBe("waiting"); // superseded ≠ awaiting
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

// --- itemChangeSet: the one derivation behind the "N files" chip + the markdown review map ---

test("itemChangeSet: a commit artifact with decorated files wins over any change rows", () => {
	const done: TodoItem = {
		...item("step", "done"),
		artifacts: [
			{ kind: "spec", path: "SPEC.md", specId: "s1" }, // agent's own artifacts are not a change set
			{
				kind: "commit",
				sha: "abc123",
				files: [
					{ path: "a.ts", status: "modified", added: 2, removed: 1 },
					{ path: "b.ts", status: "added", added: 5 },
				],
			},
			{ kind: "change", path: "stale.ts" }, // a leftover fallback row must not shadow the commit
		],
	};
	expect(itemChangeSet(done)).toEqual({
		kind: "commit",
		sha: "abc123",
		files: [
			{ path: "a.ts", status: "modified", added: 2, removed: 1 },
			{ path: "b.ts", status: "added", added: 5 },
		],
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
