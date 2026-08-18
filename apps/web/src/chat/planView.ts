import type {
	AskUserQuestionResult,
	GitFileChange,
	TodoGroupItem,
	TodoItem,
	TodoPlan,
} from "@thinkrail/contracts";
import { type AskState, deriveAskStates } from "./askState";
import type { ChatTurn } from "./types";

// Pure derivations for the chat TODO plan's rendering (SPEC §Chat TODO plan): the group-as-task view
// (group = one user ask, items = its steps) and the glance state ("is the system working or waiting on
// me?"). Presentational modules consume these via props; nothing here touches the store or transport.

/**
 * An item's host-attached change set, resolved for rendering (SPEC §Chat TODO plan) — the one derivation
 * shared by the plan popup's "N files" chip, the plan page's review rows, and the markdown export, so
 * they can never disagree on what an item produced:
 * - `commit` — the item's work was committed; `files` is the host-derived change list (path + status +
 *   `+/−`, rides the DTO). A commit artifact **without** `files` is an unresolvable sha (GC'd rewrite) →
 *   degrade silently: `null`, no affordance, never a broken diff tab.
 * - `paths` — the no-commit fallback: live-diff `change` paths (branch scope).
 */
export type ItemChangeSet =
	| { kind: "commit"; sha: string; files: GitFileChange[] }
	| { kind: "paths"; paths: string[] };

export function itemChangeSet(item: TodoItem): ItemChangeSet | null {
	const artifacts = item.artifacts ?? [];
	// Fallback `change` paths, when present, are the item's LATEST delta (a redo that couldn't commit
	// keeps its committed history but the live paths are what changed since) — they win over commits.
	const paths = artifacts.flatMap((a) => (a.kind === "change" && a.path ? [a.path] : []));
	if (paths.length > 0) return { kind: "paths", paths };
	// Commits accumulate per fix cycle (revision history) — the newest resolvable one is "the" change set
	// here; per-revision rendering is {@link itemRevisions}. Unresolvable shas degrade silently.
	const commits = itemRevisions(item);
	for (let i = commits.length - 1; i >= 0; i--) {
		const rev = commits[i];
		if (rev?.files && rev.files.length > 0)
			return { kind: "commit", sha: rev.sha, files: rev.files };
	}
	return null;
}

/** One committed revision of an item's work — `files` absent when the sha no longer resolves. */
export interface ItemRevision {
	sha: string;
	files?: GitFileChange[];
}

/** The item's commit artifacts in order (oldest→newest) — its revision history (1 TODO = N commits). */
export function itemRevisions(item: TodoItem): ItemRevision[] {
	return (item.artifacts ?? []).flatMap((a) =>
		a.kind === "commit" && a.sha ? [{ sha: a.sha, ...(a.files ? { files: a.files } : {}) }] : [],
	);
}

/** `git status`-style one-letter file marker — the one status→letter mapping (page rows + the export). */
export function statusLetter(status: GitFileChange["status"]): string {
	switch (status) {
		case "added":
		case "untracked":
			return "A";
		case "deleted":
			return "D";
		case "renamed":
			return "R";
		default:
			return "M";
	}
}

/** A commit change set's totals — the one summary derivation (the page's header row + the export). */
export function changeSetStat(files: GitFileChange[]): {
	count: number;
	added: number;
	removed: number;
} {
	return {
		count: files.length,
		added: files.reduce((sum, f) => sum + (f.added ?? 0), 0),
		removed: files.reduce((sum, f) => sum + (f.removed ?? 0), 0),
	};
}

/** done / total across a group's steps — the header badge ("2/3"). */
export function groupProgress(group: TodoGroupItem): { done: number; total: number } {
	return {
		done: group.todos.filter((t) => t.status === "done").length,
		total: group.todos.length,
	};
}

/** Every item of a plan, flattened for counting and for finding the current step — groups first, the
 * user's loose lane last (the order the panel and the agent's text plan read in). Order is incidental to
 * this app's uses; where it is load-bearing is `pi-todos`, whose `replaceAll` uses it to decide which
 * `in_progress` survives. */
export function flatItems(plan: TodoPlan): TodoItem[] {
	return [...plan.groups.flatMap((g) => g.todos), ...plan.todos];
}

/** done / total and the current in-progress item — the "what's happening now" glance. */
export function planSummary(plan: TodoPlan): {
	done: number;
	total: number;
	current: TodoItem | undefined;
} {
	const all = flatItems(plan);
	return {
		done: all.filter((t) => t.status === "done").length,
		total: all.length,
		current: all.find((t) => t.status === "in_progress"),
	};
}

/**
 * Classify an agent's self-reported verification line for the status badge — the ONE home of the
 * heuristic (popup, plan page, review card, export all read it): an explicit "not verified" /
 * "unverified" / "no verification" claim renders as unverified (warning glyph); anything else that
 * names a check renders as verified-as-claimed (check glyph). Absence of the field is the caller's
 * case (no badge — and on a reviewable item, a visible gap).
 */
export function verificationStatus(verification: string): "claimed" | "unverified" {
	return /\b(not\s+verified|unverified|no\s+verification)\b/i.test(verification)
		? "unverified"
		: "claimed";
}

/**
 * The reviewable items of a plan, in plan order — exactly those the host decorated with `review`
 * (reviewable ≡ carries a host change set; the gate has ONE home, server-side). The Review mode's list.
 */
export function reviewableItems(plan: TodoPlan): TodoItem[] {
	return flatItems(plan).filter((t) => t.review !== undefined);
}

/**
 * Whether an item's review is SETTLED: approved, with nothing new landed since the approval (no
 * unreviewed delta). The one derivation behind the circled “Verified” glyph, the reviewed counter,
 * and the review card hiding its actions — an approved item that grew a fresh revision drops back out.
 */
export function reviewSettled(item: TodoItem): boolean {
	const r = item.review;
	return r !== undefined && r.state === "reviewed" && (r.unreviewedShas?.length ?? 0) === 0;
}

/** reviewed / total across the reviewable items — the `R/K reviewed` counter, separate from done/total. */
export function reviewProgress(plan: TodoPlan): { reviewed: number; total: number } {
	const items = reviewableItems(plan);
	return {
		reviewed: items.filter(reviewSettled).length,
		total: items.length,
	};
}

/**
 * The plan-level completion summary, gated on the plan actually being complete: the agent writes it when
 * the last item flips done, and a re-opened plan (new items, a reset step) hides it until the agent
 * rewrites it at the next completion — so the page never shows a stale "all done" note over open work.
 */
export function planCompletionSummary(plan: TodoPlan): string | undefined {
	if (!plan.summary) return undefined;
	const all = flatItems(plan);
	if (all.length === 0 || all.some((t) => t.status !== "done")) return undefined;
	return plan.summary;
}

/**
 * The header strip's live status — **the agent's state, decoupled from the checkboxes** (SPEC §Chat TODO
 * plan). The old strip only showed status through the `in_progress` step, so an agent that was
 * `waiting_question` with everything `done` read as "finished". Here the rule is on the glance:
 * - `working` / `waiting_question` → always `show` (the agent is doing / needs you, regardless of boxes);
 * - `waiting` (stopped, no pending question) → `show` only when open steps remain (stopped mid-plan =
 *   "Paused"); on a clean finish (all done / empty, idle) `show` is false — don't cry "paused".
 * `showLabel` hides the label only for `working` *with* a current step (its title conveys it); `title` is
 * the current step's title when there is one. Pure; the strip just renders this.
 */
export function stripStatus(
	glance: PlanGlance,
	summary: { done: number; total: number; current: TodoItem | undefined },
): { show: boolean; showLabel: boolean; title?: string } {
	const openLeft = summary.total - summary.done > 0;
	return {
		show: glance !== "waiting" || openLeft,
		showLabel: glance !== "working" || !summary.current,
		...(summary.current ? { title: summary.current.title } : {}),
	};
}

/**
 * The panel's status-ordered sections (SPEC §Chat TODO plan): the plan is read top-to-bottom as a
 * status flow — **in progress**, then **to do**, then **done** — while keeping the task groups whole.
 * `groups` are bucketed by their derived {@link groupStatus}; loose items (the user's own adds) by
 * their own `status`. Finished *steps* stay inline in their (active/pending) group — only fully-`done`
 * groups and `done` loose items land in `done`. Pure; `TodoList` just renders what this returns.
 */
export interface PlanSections {
	activeGroups: TodoGroupItem[];
	activeLoose: TodoItem[];
	pendingGroups: TodoGroupItem[];
	pendingLoose: TodoItem[];
	doneGroups: TodoGroupItem[];
	doneLoose: TodoItem[];
}

export function planSections(plan: TodoPlan): PlanSections {
	const s: PlanSections = {
		activeGroups: [],
		activeLoose: [],
		pendingGroups: [],
		pendingLoose: [],
		doneGroups: [],
		doneLoose: [],
	};
	for (const group of plan.groups) {
		if (group.status === "active") s.activeGroups.push(group);
		else if (group.status === "done") s.doneGroups.push(group);
		else s.pendingGroups.push(group);
	}
	for (const todo of plan.todos) {
		if (todo.status === "in_progress") s.activeLoose.push(todo);
		else if (todo.status === "done") s.doneLoose.push(todo);
		else s.pendingLoose.push(todo);
	}
	return s;
}

/**
 * Whether the system is working or waiting on the user — the glance state that keeps an `in_progress`
 * item from lying when the agent has stopped. **Derived from session state, never stored**: the agent
 * sets nothing here, so it can't drift — any stop shows as waiting, whether or not the agent knew it
 * was stopping (a question, an error, or just the turn ending).
 */
export type PlanGlance = "working" | "waiting_question" | "waiting";

export function planGlance(isStreaming: boolean, askStates: Record<string, AskState>): PlanGlance {
	if (isStreaming) return "working";
	const awaiting = Object.values(askStates).some((s) => !s.answer && !s.superseded);
	return awaiting ? "waiting_question" : "waiting";
}

/** A session runtime's glance, composing {@link deriveAskStates} + {@link planGlance} — the one place
 * that derives it straight from a runtime, for callers (e.g. the add-nudge) that don't already hold the
 * ask states the way `ChatView` does. */
export function sessionGlance(rt: {
	isStreaming: boolean;
	turns: ChatTurn[];
	askAnswers: Record<string, AskUserQuestionResult>;
}): PlanGlance {
	return planGlance(rt.isStreaming, deriveAskStates(rt.turns, rt.askAnswers));
}

/**
 * Should a user's just-added item **wake** the agent? No while it's `waiting_question` — an
 * `ask_user_question` is pending, so waking it would make it go work the new item and forget to come
 * back to its own question; the item just queues at the end (loose) and is picked up on the agent's next
 * natural turn (when the user answers, or a later idle nudge). Yes when `working` (a `followUp` rides the
 * live turn) or plain `waiting`/idle (a `prompt` wakes it) — "disturb it only when it isn't waiting."
 */
export function shouldNudgeOnAdd(glance: PlanGlance): boolean {
	return glance !== "waiting_question";
}
