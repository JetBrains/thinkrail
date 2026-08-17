// A chat's TODO list (scoped by sessionId), mapped to the wire DTOs. The host both reads and writes the
// plan here (the user's UI edits). Value-imports pi-todos' pi-free `TodoStore` (the extension itself
// never reaches the bundle), the way `server/src/spec` value-imports `pi-spec-graph/core`. The store is
// the source of truth and re-reads its per-session file on every op, so a UI edit and the agent's
// in-session `todo_*` writes converge on the same `.thinkrail/context/todos/<sessionId>.json`.

import type {
	GitFileChange,
	TodoArtifact,
	TodoItem,
	TodoPlan,
	TodoStatus,
} from "@thinkrail/contracts";
import {
	flatItems,
	groupStatus,
	type Todo as StoredItem,
	type TodoPlan as StoredPlan,
	TodoStore,
} from "pi-todos/core";
import { gitStatus } from "../git";
import { getWorkspace } from "../workspaces";
import { settleChangeArtifacts } from "./artifacts";
import { dropItemBaseline, removeSessionBaselines } from "./baselines";

/** The store rooted at a workspace's worktree for one chat session. `TodoStore` is stateless (re-reads
 * the file every op), so a fresh instance per call is free — no cache. `getWorkspace` throws on unknown. */
function storeFor(workspaceId: string, sessionId: string): TodoStore {
	return new TodoStore(getWorkspace(workspaceId).worktreePath, sessionId);
}

/**
 * A commit's recorded changes (path + status + `+/−`), memoized **by workspace + sha** — the sha names
 * an immutable object, so a successful resolution can never go stale *within the repository that holds
 * it*. Resolvability is repository-local, though: two clones can hold the same sha while only one still
 * has the object (the other rewrote and pruned it), so a hit from one workspace must never satisfy
 * another's resolution check — hence the composite key. Only successes are cached: a transient git
 * failure (or a GC'd/unknown sha — `gitStatus` throws `UNKNOWN_COMMIT`) resolves to `undefined` now and
 * retries on the next list. Session-independent, so one host-wide map is still correct.
 */
const commitFilesCache = new Map<string, GitFileChange[]>();

function resolveCommitFiles(workspaceId: string, sha: string): GitFileChange[] | undefined {
	const key = `${workspaceId}\u0000${sha}`;
	const hit = commitFilesCache.get(key);
	if (hit) return hit;
	try {
		const files = gitStatus(workspaceId, { kind: "commit", sha }).changes;
		commitFilesCache.set(key, files);
		return files;
	} catch {
		return undefined; // unknown sha / git failure — ship the artifact bare (the client degrades)
	}
}

/**
 * One stored item → the wire DTO: a `commit` artifact is **unfolded** — decorated with its derived
 * `files` (the review map's "N files" + per-file links come from here, never from denormalized JSON).
 * An unresolvable sha ships the artifact without `files` — the client's degrade signal.
 */
function toWireItem(workspaceId: string, item: StoredItem): TodoItem {
	if (!item.artifacts) return item;
	const artifacts = item.artifacts.map((a): TodoArtifact => {
		if (a.kind !== "commit" || !a.sha) return a;
		const files = resolveCommitFiles(workspaceId, a.sha);
		return files ? { ...a, files } : a;
	});
	return { ...item, artifacts };
}

/**
 * The chat's whole TODO plan (loose items + named groups). **Awaits the workspace's in-flight change-set
 * reconcile first** ({@link settleChangeArtifacts}), so a read triggered by the `todo_*` event that started
 * that reconcile can't observe a `done` item before its commit artifact is stored.
 */
export async function listTodos(params: {
	workspaceId: string;
	sessionId: string;
}): Promise<TodoPlan> {
	await settleChangeArtifacts(params.workspaceId);
	const plan = storeFor(params.workspaceId, params.sessionId).read();
	// Decorate on the way out: each group with its derived task status (the rule lives in `pi-todos`,
	// which owns plan semantics, and reaches the client on the DTO so `apps/web` — which can't import the
	// package — never re-derives it), and each `commit` artifact with its derived `files` (see above).
	return {
		todos: plan.todos.map((t) => toWireItem(params.workspaceId, t)),
		groups: plan.groups.map((group) => ({
			...group,
			todos: group.todos.map((t) => toWireItem(params.workspaceId, t)),
			status: groupStatus(group),
		})),
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

/**
 * Drop a deleted chat's baseline sidecar — its open work windows must die with the session, or every
 * later overlap check in the workspace would see a permanently "open" foreign window and force sibling
 * chats into the path-list fallback forever. Best-effort and idempotent (see `baselines.ts`); the
 * `session.delete` handler calls it after the delete transaction commits.
 */
export function removeSessionTodoWindows(params: { workspaceId: string; sessionId: string }): void {
	removeSessionBaselines(getWorkspace(params.workspaceId).worktreePath, params.sessionId);
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
	const root = getWorkspace(params.workspaceId).worktreePath;
	new TodoStore(root, params.sessionId).remove(params.id);
	// This mutation happens outside a reconcile (no `todo_*` tool end fires for a UI edit), so close the
	// removed item's work window here — an orphan baseline would read as "open" in every later overlap
	// check and permanently force sibling chats into the path-list fallback.
	dropItemBaseline(root, params.sessionId, params.id);
	return { ok: true } as const;
}
