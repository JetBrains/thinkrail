import type {
	AskUserQuestionResult,
	GitFileChange,
	ReviewComment,
	TodoGroupItem,
	TodoItem,
	TodoPlan,
} from "@thinkrail/contracts";
import { type AskState, deriveAskStates } from "./askState";
import type { ChatTurn } from "./types";

export type ItemChangeSet =
	| { kind: "commit"; sha: string; files: GitFileChange[] }
	| { kind: "paths"; paths: string[] };

export function itemChangeSet(item: TodoItem): ItemChangeSet | null {
	const artifacts = item.artifacts ?? [];
	const paths = artifacts.flatMap((a) => (a.kind === "change" && a.path ? [a.path] : []));
	if (paths.length > 0) return { kind: "paths", paths };
	const commits = itemRevisions(item);
	for (let i = commits.length - 1; i >= 0; i--) {
		const rev = commits[i];
		if (rev?.files && rev.files.length > 0)
			return { kind: "commit", sha: rev.sha, files: rev.files };
	}
	return null;
}

export interface ItemRevision {
	sha: string;
	files?: GitFileChange[];
}

export function itemRevisions(item: TodoItem): ItemRevision[] {
	return (item.artifacts ?? []).flatMap((a) =>
		a.kind === "commit" && a.sha ? [{ sha: a.sha, ...(a.files ? { files: a.files } : {}) }] : [],
	);
}

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

export function changeSetCounts(set: ItemChangeSet): {
	count: number;
	added: number;
	removed: number;
} {
	return set.kind === "paths"
		? { count: set.paths.length, added: 0, removed: 0 }
		: changeSetStat(set.files);
}

export function groupProgress(group: TodoGroupItem): { done: number; total: number } {
	return {
		done: group.todos.filter((t) => t.status === "done").length,
		total: group.todos.length,
	};
}

export function flatItems(plan: TodoPlan): TodoItem[] {
	return [...plan.groups.flatMap((g) => g.todos), ...plan.todos];
}

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

export function verificationStatus(verification: string): "claimed" | "unverified" {
	return /\b(not\s+verified|unverified|no\s+verification)\b/i.test(verification)
		? "unverified"
		: "claimed";
}

export function reviewableItems(plan: TodoPlan): TodoItem[] {
	return flatItems(plan).filter((t) => t.review !== undefined);
}

export function reviewSettled(item: TodoItem): boolean {
	const r = item.review;
	return r !== undefined && r.state === "reviewed" && (r.unreviewedShas?.length ?? 0) === 0;
}

export function reviewChangesRequested(item: TodoItem): boolean {
	return item.review?.state === "changes_requested";
}

export function itemOpenFindings(
	item: TodoItem,
	comments: Pick<ReviewComment, "author" | "status" | "anchor" | "origin">[] | undefined,
	sessionId?: string,
): number {
	if (!comments || comments.length === 0) return 0;
	const set = itemChangeSet(item);
	const paths = set
		? new Set(set.kind === "commit" ? set.files.map((f) => f.path) : set.paths)
		: null;
	return comments.filter((c) => {
		if (c.author !== "agent" || (c.status !== "draft" && c.status !== "sent")) return false;
		if (c.origin) {
			return c.origin.todoId === item.id && (!sessionId || c.origin.sessionId === sessionId);
		}
		return paths !== null && c.anchor?.path !== undefined && paths.has(c.anchor.path);
	}).length;
}

export function reviewProgress(plan: TodoPlan): { reviewed: number; total: number } {
	const items = reviewableItems(plan);
	return {
		reviewed: items.filter(reviewSettled).length,
		total: items.length,
	};
}

export function planCompletionSummary(plan: TodoPlan): string | undefined {
	if (!plan.summary) return undefined;
	const all = flatItems(plan);
	if (all.length === 0 || all.some((t) => t.status !== "done")) return undefined;
	return plan.summary;
}

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

export type PlanGlance = "working" | "waiting_question" | "waiting";

export function planGlance(isStreaming: boolean, askStates: Record<string, AskState>): PlanGlance {
	if (isStreaming) return "working";
	const awaiting = Object.values(askStates).some((s) => !s.answer && !s.superseded);
	return awaiting ? "waiting_question" : "waiting";
}

export function sessionGlance(rt: {
	isStreaming: boolean;
	turns: ChatTurn[];
	askAnswers: Record<string, AskUserQuestionResult>;
}): PlanGlance {
	return planGlance(rt.isStreaming, deriveAskStates(rt.turns, rt.askAnswers));
}

export function shouldNudgeOnAdd(glance: PlanGlance): boolean {
	return glance !== "waiting_question";
}
