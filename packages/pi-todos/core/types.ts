export const TODO_STATUSES = ["pending", "in_progress", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_ORIGINS = ["agent", "user"] as const;
export type TodoOrigin = (typeof TODO_ORIGINS)[number];

export const TODO_ARTIFACT_KINDS = ["file", "change", "spec", "commit"] as const;
export type TodoArtifactKind = (typeof TODO_ARTIFACT_KINDS)[number];

export interface TodoArtifact {
	kind: TodoArtifactKind;
	path?: string;
	label?: string;
	specId?: string;
	sha?: string;
}

export interface Todo {
	id: string;
	title: string;
	status: TodoStatus;
	origin: TodoOrigin;
	note?: string;
	summary?: string;
	verification?: string;
	commitSubject?: string;
	artifacts?: TodoArtifact[];
	createdAt: string;
	updatedAt: string;
}

export const TODO_GROUP_STATUSES = ["pending", "active", "done"] as const;
export type TodoGroupStatus = (typeof TODO_GROUP_STATUSES)[number];

export interface TodoGroup {
	id: string;
	title: string;
	todos: Todo[];
}

export interface TodoPlan {
	todos: Todo[];
	groups: TodoGroup[];
	// see core/SPEC.md "Summaries" for storage + reopen-invalidation rules
	summary?: string;
}

export interface TodoFile {
	version: 6;
	todos: Todo[];
	groups: TodoGroup[];
	summary?: string;
}

export interface TodoInput {
	title: string;
	note?: string;
	origin?: TodoOrigin;
	group?: string;
	after?: string;
	artifacts?: TodoArtifact[];
}

export interface TodoUpdateResult {
	todo: Todo;
	paused: Todo[];
}

// Why a discriminated union: `TodoStore.promote` can fail for four distinct reasons and the agent's
// recovery differs per reason. A plain `TodoGroup | undefined` collapses all four into "no", so the
// tool must say "doesn't exist" even when the caller can fix it by retrying with a new title. The
// discriminated result lets `todo_promote`'s error message name the actual cause.
export type TodoPromoteFailure =
	| "unknown-id" // id isn't anywhere in the plan
	| "grouped-step" // id is a step inside an existing group, promotion doesn't apply
	| "empty-title" // titleOverride normalized to empty, a blank group has no addressable task
	| "title-collision"; // another group already uses that title, silent merge would lose the ask

export type TodoPromoteResult =
	| { ok: true; group: TodoGroup }
	| { ok: false; reason: TodoPromoteFailure };

export interface TodoPatch {
	title?: string;
	status?: TodoStatus;
	note?: string;
	summary?: string;
	verification?: string;
	commitSubject?: string;
	artifacts?: TodoArtifact[];
}

export interface WriteItem {
	title: string;
	status?: TodoStatus;
	note?: string;
	summary?: string;
	verification?: string;
	artifacts?: TodoArtifact[];
}

export interface WritePlan {
	groups?: { title: string; todos: WriteItem[] }[];
}
