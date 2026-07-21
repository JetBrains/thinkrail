// The TODO model — pi-free, shared by the store, the tools layer, and (value-imported) the host viewer.
// A plan is a flat list of **loose** items (the agent's standalone tasks + everything the user adds —
// never grouped) plus a list of named **groups**, each a titled container with its own ordered items.
// The agent authors a group as a whole (a title + its list of items), not by tagging each item with a
// topic; the user's own adds always stay loose. See todos-design.md.

/** Lifecycle of a backlog item. The agent flips these as it works (pending → in_progress → done). */
export const TODO_STATUSES = ["pending", "in_progress", "done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/**
 * Who put the item on the list. `user` items are the human's requests — the agent works them but never
 * rewrites, groups, or drops them; in particular `todo_write` (the agent re-laying its plan) keeps them.
 */
export const TODO_ORIGINS = ["agent", "user"] as const;
export type TodoOrigin = (typeof TODO_ORIGINS)[number];

/** One backlog item. `id`/timestamps are store-assigned. */
export interface Todo {
	id: string;
	title: string;
	status: TodoStatus;
	/** Who added it — the agent's plan vs the user's request (protects user items from re-plans). */
	origin: TodoOrigin;
	/** A short secondary line — an origin hint or a note. */
	note?: string;
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

/** The on-disk file shape (`.thinkrail/todos/<sessionId>.json`). `version` guards future migrations. */
export interface TodoFile {
	version: 2;
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
}

/** The fields a caller may change on an existing item (all optional). */
export interface TodoPatch {
	title?: string;
	status?: TodoStatus;
	note?: string;
}

/** One item in a `todo_write` plan — a title plus an optional initial status / note. */
export interface WriteItem {
	title: string;
	status?: TodoStatus;
	note?: string;
}

/** The plan a `todo_write` lays out: loose items + named groups (each carrying its own items). */
export interface WritePlan {
	todos?: WriteItem[];
	groups?: { title: string; todos: WriteItem[] }[];
}
