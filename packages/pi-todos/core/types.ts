// The TODO model — pi-free, shared by the store, the tools layer, and (value-imported) the host viewer.
// A plan is a list of **loose** items plus a list of named **groups** (each a titled container with its
// own ordered items). By convention (see the `todos` skill) the two are distinct lanes: the agent always
// authors its own plan as groups (a title + its list of items, authored whole), and the loose list holds
// what the **user** adds — never grouped. The store enforces neither; the split is the skill's contract.
// See todos-design.md.

/** Lifecycle of a backlog item. The agent flips these as it works (pending → in_progress → done). */
export const TODO_STATUSES = ["pending", "in_progress", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/**
 * Who put the item on the list. `user` items are the human's requests — the agent works them but never
 * rewrites, groups, or drops them; in particular `todo_write` (the agent re-laying its plan) keeps them.
 */
export const TODO_ORIGINS = ["agent", "user"] as const;
export type TodoOrigin = (typeof TODO_ORIGINS)[number];

/**
 * What an artifact points at: a source `file`, a `change` (its diff vs the workspace base branch), or a
 * `spec` (a spec-graph node). All three are addressed by a worktree-relative `path` — the diff of a
 * `change` is computed live at click time, never stored here.
 */
export const TODO_ARTIFACT_KINDS = ["file", "change", "spec"] as const;
export type TodoArtifactKind = (typeof TODO_ARTIFACT_KINDS)[number];

/** A link from an item to what the work produced. `path` is worktree-relative (the nav address). */
export interface TodoArtifact {
	kind: TodoArtifactKind;
	path: string;
	/** Display text; the UI falls back to the path's basename when absent. */
	label?: string;
	/** For `spec` only: the durable spec-graph id (survives a file move); `path` is what opens a tab. */
	specId?: string;
}

/** One backlog item. `id`/timestamps are store-assigned. */
export interface Todo {
	id: string;
	title: string;
	status: TodoStatus;
	/** Who added it — the agent's plan vs the user's request (protects user items from re-plans). */
	origin: TodoOrigin;
	/** A short secondary line — an origin hint or a note. */
	note?: string;
	/** Links to what the work produced (files/specs by the agent; changes by the host on `done`). */
	artifacts?: TodoArtifact[];
	/** ISO-8601 creation / last-mutation timestamps (store-managed). */
	createdAt: string;
	updatedAt: string;
}

/** A named container of items — the agent's thematic cluster. `id` is store-assigned. */
export interface TodoGroup {
	id: string;
	title: string;
	todos: Todo[];
}

/** The whole plan: loose items (standalone + user), then the named groups (each with its own items). */
export interface TodoPlan {
	todos: Todo[];
	groups: TodoGroup[];
}

/**
 * The on-disk file shape (`.thinkrail/context/todos/<sessionId>.json`). `version` guards migrations. `3` added
 * item `artifacts`; a `2` file (no artifacts) reads cleanly and is upgraded to `3` on the next write.
 */
export interface TodoFile {
	version: 3;
	todos: Todo[];
	groups: TodoGroup[];
}

/**
 * The fields a caller may set when adding one item. `origin` defaults to `agent`; `group` (a group
 * title) places it in that named group — created if new — instead of loose.
 */
export interface TodoInput {
	title: string;
	note?: string;
	origin?: TodoOrigin;
	group?: string;
	artifacts?: TodoArtifact[];
}

/** The fields a caller may change on an existing item (all optional). */
export interface TodoPatch {
	title?: string;
	status?: TodoStatus;
	note?: string;
	/** Replace the item's artifacts wholesale; `[]` clears them. */
	artifacts?: TodoArtifact[];
}

/** One item in a `todo_write` plan — a title plus an optional initial status / note / artifacts. */
export interface WriteItem {
	title: string;
	status?: TodoStatus;
	note?: string;
	artifacts?: TodoArtifact[];
}

/** The plan a `todo_write` lays out: loose items + named groups (each carrying its own items). */
export interface WritePlan {
	todos?: WriteItem[];
	groups?: { title: string; todos: WriteItem[] }[];
}
