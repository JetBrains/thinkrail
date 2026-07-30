// A chat's TODO list (scoped by sessionId), mapped to the wire DTOs. The host both reads and writes the
// plan here (the user's UI edits). Value-imports pi-todos' pi-free `TodoStore` (the extension itself
// never reaches the bundle), the way `server/src/spec` value-imports `pi-spec-graph/core`. The store is
// the source of truth and re-reads its per-session file on every op, so a UI edit and the agent's
// in-session `todo_*` writes converge on the same `.thinkrail/context/todos/<sessionId>.json`.

import type { TodoItem, TodoPlan, TodoStatus } from "@thinkrail/contracts";
import { flatItems, groupStatus, type TodoPlan as StoredPlan, TodoStore } from "pi-todos/core";
import { getWorkspace } from "../workspaces";

/** The store rooted at a workspace's worktree for one chat session. `TodoStore` is stateless (re-reads
 * the file every op), so a fresh instance per call is free — no cache. `getWorkspace` throws on unknown. */
function storeFor(workspaceId: string, sessionId: string): TodoStore {
	return new TodoStore(getWorkspace(workspaceId).worktreePath, sessionId);
}

/** The chat's whole TODO plan (loose items + named groups). */
export function listTodos(params: { workspaceId: string; sessionId: string }): TodoPlan {
	const plan = storeFor(params.workspaceId, params.sessionId).read();
	// Decorate each group with its derived task status: the rule lives in `pi-todos` (which owns plan
	// semantics) and reaches the client on the DTO, so `apps/web` renders it instead of keeping a second
	// copy of the truth table it can never import. Spread the plan so a future field can't be dropped here.
	return {
		...plan,
		groups: plan.groups.map((group) => ({ ...group, status: groupStatus(group) })),
	};
}

/**
 * How many items in the chat's plan are unfinished (any status but `done`), loose + grouped. The
 * counting rule lives here (todos owns plan semantics); `session.list`'s handler uses it to decorate
 * `SessionSummary.openTodos` so a client can auto-open chats with work in progress. A session with no
 * todo file reads as an empty plan → 0.
 */
export function countOpenTodos(params: { workspaceId: string; sessionId: string }): number {
	// Straight off the store, not through `listTodos` — the count reads item statuses only, so routing it
	// through the wire mapper would build (and discard) a decorated DTO once per session on every
	// `session.list`.
	return openTodoCount(storeFor(params.workspaceId, params.sessionId).read());
}

/**
 * The pure counting rule behind {@link countOpenTodos}: unfinished = any status but `done`. Typed against
 * the **stored** plan (the wire DTO is assignable to it), since the count reads item statuses only and has
 * no business requiring the host-derived group decoration.
 */
export function openTodoCount(plan: StoredPlan): number {
	return flatItems(plan).filter((item) => item.status !== "done").length;
}

/** Append one item to the chat's list. */
export function addTodo(params: {
	workspaceId: string;
	sessionId: string;
	title: string;
	note?: string;
}): TodoItem {
	const title = params.title?.trim();
	if (!title) throw new Error("A TODO title is required.");
	// Adds over the wire come from the UI, i.e. the human — tag them `user` so the agent's re-plans
	// (todo_write) never drop them.
	const input: { title: string; note?: string; origin: "user" } = {
		title,
		origin: "user",
	};
	if (params.note !== undefined) input.note = params.note;
	return storeFor(params.workspaceId, params.sessionId).add(input);
}

/** Update an item; throws (→ a `{ ok:false }` WS response) if the id is unknown. */
export function updateTodo(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
	status?: TodoStatus;
	title?: string;
	note?: string;
}): TodoItem {
	const patch: { status?: TodoStatus; title?: string; note?: string } = {};
	if (params.status !== undefined) patch.status = params.status;
	if (params.title !== undefined) patch.title = params.title;
	if (params.note !== undefined) patch.note = params.note;
	// `update` also returns any auto-demoted (`paused`) items; the wire response stays a bare TodoItem —
	// the UI re-reads the whole plan on change, so the demotions arrive with the next `todo.list`.
	const result = storeFor(params.workspaceId, params.sessionId).update(params.id, patch);
	if (!result) throw new Error(`No TODO with id "${params.id}".`);
	return result.todo;
}

/** Remove an item (idempotent — removing an absent id is not an error). */
export function removeTodo(params: { workspaceId: string; sessionId: string; id: string }): {
	ok: true;
} {
	storeFor(params.workspaceId, params.sessionId).remove(params.id);
	return { ok: true } as const;
}
