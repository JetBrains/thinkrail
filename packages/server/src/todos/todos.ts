// A chat's TODO list (scoped by sessionId), mapped to the wire DTOs. The host both reads and writes the
// plan here (the user's UI edits). Value-imports pi-todos' pi-free `TodoStore` (the extension itself
// never reaches the bundle), the way `server/src/spec` value-imports `pi-spec-graph/core`. The store is
// the source of truth and re-reads its per-session file on every op, so a UI edit and the agent's
// in-session `todo_*` writes converge on the same `.thinkrail/context/todos/<sessionId>.json`.

import type { TodoItem, TodoPlan, TodoStatus } from "@thinkrail/contracts";
import { TodoStore } from "pi-todos/core";
import { getWorkspace } from "../workspaces";

/** The store rooted at a workspace's worktree for one chat session. `TodoStore` is stateless (re-reads
 * the file every op), so a fresh instance per call is free — no cache. `getWorkspace` throws on unknown. */
function storeFor(workspaceId: string, sessionId: string): TodoStore {
	return new TodoStore(getWorkspace(workspaceId).worktreePath, sessionId);
}

/** The chat's whole TODO plan (loose items + named groups). */
export function listTodos(params: { workspaceId: string; sessionId: string }): TodoPlan {
	return storeFor(params.workspaceId, params.sessionId).read();
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
	const todo = storeFor(params.workspaceId, params.sessionId).update(params.id, patch);
	if (!todo) throw new Error(`No TODO with id "${params.id}".`);
	return todo;
}

/** Remove an item (idempotent — removing an absent id is not an error). */
export function removeTodo(params: { workspaceId: string; sessionId: string; id: string }): {
	ok: true;
} {
	storeFor(params.workspaceId, params.sessionId).remove(params.id);
	return { ok: true } as const;
}
