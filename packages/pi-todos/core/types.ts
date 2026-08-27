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
	version: 5;
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

export interface TodoPatch {
	title?: string;
	status?: TodoStatus;
	note?: string;
	summary?: string;
	verification?: string;
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
	todos?: WriteItem[];
	groups?: { title: string; todos: WriteItem[] }[];
}
