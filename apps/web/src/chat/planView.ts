import type {
	AskUserQuestionResult,
	GitFileChange,
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
	const commit = artifacts.find((a) => a.kind === "commit" && !!a.sha);
	if (commit?.sha) {
		return commit.files && commit.files.length > 0
			? { kind: "commit", sha: commit.sha, files: commit.files }
			: null;
	}
	const paths = artifacts.flatMap((a) => (a.kind === "change" && a.path ? [a.path] : []));
	return paths.length > 0 ? { kind: "paths", paths } : null;
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
