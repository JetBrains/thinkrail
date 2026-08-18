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
	TodoReviewInfo,
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
import {
	dropReviewRecord,
	putReviewRecord,
	readReviewRecords,
	removeSessionReviews,
	type TodoReviewRecord,
} from "./reviews";

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
function toWireItem(
	workspaceId: string,
	item: StoredItem,
	record: TodoReviewRecord | undefined,
): TodoItem {
	if (!item.artifacts) return item;
	const artifacts = item.artifacts.map((a): TodoArtifact => {
		if (a.kind !== "commit" || !a.sha) return a;
		const files = resolveCommitFiles(workspaceId, a.sha);
		return files ? { ...a, files } : a;
	});
	const review = reviewInfo(item, record);
	return review ? { ...item, artifacts, review } : { ...item, artifacts };
}

/** The item's commit shas, oldest→newest — the revision history the review watermark diffs against. */
function commitShas(item: StoredItem): string[] {
	return (item.artifacts ?? []).flatMap((a) => (a.kind === "commit" && a.sha ? [a.sha] : []));
}

/** True when the item carries a host change set — the deterministic "reviewable" gate. */
function isReviewable(item: StoredItem): boolean {
	return (item.artifacts ?? []).some(
		(a) => (a.kind === "commit" && a.sha) || (a.kind === "change" && a.path),
	);
}

/**
 * The review decoration for one item — present only on reviewable items (those with a host change set),
 * so research/verification steps never demand review. `unreviewed` is the absence of a stored record;
 * `unreviewedShas` (only once a record exists) are the commits appended since the user last acted — the
 * "changed since review" delta the revision view shows.
 */
function reviewInfo(
	item: StoredItem,
	record: TodoReviewRecord | undefined,
): TodoReviewInfo | undefined {
	if (!isReviewable(item)) return undefined;
	const shas = commitShas(item);
	const info: TodoReviewInfo = { state: record?.state ?? "unreviewed", revision: shas.length };
	if (record) {
		const seen = new Set(record.reviewedShas);
		const unreviewed = shas.filter((sha) => !seen.has(sha));
		if (unreviewed.length > 0) info.unreviewedShas = unreviewed;
		if (record.state === "changes_requested" && record.feedback) info.feedback = record.feedback;
		info.at = record.at;
	}
	return info;
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
	const root = getWorkspace(params.workspaceId).worktreePath;
	const plan = new TodoStore(root, params.sessionId).read();
	const records = readReviewRecords(root, params.sessionId);
	// Decorate on the way out: each group with its derived task status (the rule lives in `pi-todos`,
	// which owns plan semantics, and reaches the client on the DTO so `apps/web` — which can't import the
	// package — never re-derives it), each `commit` artifact with its derived `files` (see above), and
	// each reviewable item with its review state (host sidecar — never the agent-writable plan file).
	const wire: TodoPlan = {
		todos: plan.todos.map((t) => toWireItem(params.workspaceId, t, records[t.id])),
		groups: plan.groups.map((group) => ({
			...group,
			todos: group.todos.map((t) => toWireItem(params.workspaceId, t, records[t.id])),
			status: groupStatus(group),
		})),
	};
	if (plan.summary) wire.summary = plan.summary;
	return wire;
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
	const root = getWorkspace(params.workspaceId).worktreePath;
	removeSessionBaselines(root, params.sessionId);
	removeSessionReviews(root, params.sessionId);
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
	// check and permanently force sibling chats into the path-list fallback. The review record goes with
	// it (orphan records are inert, but the lifecycle stays symmetric with the baselines sidecar).
	dropItemBaseline(root, params.sessionId, params.id);
	dropReviewRecord(root, params.sessionId, params.id);
	return { ok: true } as const;
}

/** A stored item by id, with its workspace root — shared lookup of the review ops below. */
function reviewableItem(params: { workspaceId: string; sessionId: string; id: string }): {
	root: string;
	item: StoredItem;
} {
	const root = getWorkspace(params.workspaceId).worktreePath;
	const item = new TodoStore(root, params.sessionId).get(params.id);
	if (!item) throw new Error(`No TODO with id "${params.id}".`);
	if (!isReviewable(item))
		throw new Error(`TODO "${params.id}" has no change set to review.`);
	return { root, item };
}

/**
 * Approve a reviewable item: record `reviewed` plus the watermark — the item's current commit shas, so
 * a commit appended by a later fix cycle reads as the unreviewed delta. Rejected (throws → `{ok:false}`
 * on the wire) for an unknown or non-reviewable item.
 */
export function approveTodoReview(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
}): { ok: true } {
	const { root, item } = reviewableItem(params);
	putReviewRecord(root, params.sessionId, params.id, {
		state: "reviewed",
		reviewedShas: commitShas(item),
		at: new Date().toISOString(),
	});
	return { ok: true } as const;
}

/**
 * Record an ask-to-fix: `changes_requested` + the feedback + the watermark, and render the context
 * package the host fires into the item's own chat (title/note, the completion summary, the change-set
 * reference — never the full diff; the agent reads the worktree/commits with its own tools — and the
 * feedback verbatim, plus the re-open-this-item instruction). Returns the package and the record it
 * replaced so the host can roll back when the send is rejected pre-turn.
 */
export function requestTodoFix(params: {
	workspaceId: string;
	sessionId: string;
	id: string;
	feedback: string;
}): { pkg: string; previous: TodoReviewRecord | undefined } {
	const feedback = params.feedback.trim();
	if (!feedback) throw new Error("Fix feedback must not be empty.");
	const { root, item } = reviewableItem(params);
	const previous = putReviewRecord(root, params.sessionId, params.id, {
		state: "changes_requested",
		reviewedShas: commitShas(item),
		feedback,
		at: new Date().toISOString(),
	});
	return { pkg: renderFixPackage(item, feedback), previous };
}

/** Undo {@link requestTodoFix}'s record after a pre-turn send rejection (restores what it replaced). */
export function rollbackTodoFix(
	params: { workspaceId: string; sessionId: string; id: string },
	previous: TodoReviewRecord | undefined,
): void {
	dropReviewRecord(getWorkspace(params.workspaceId).worktreePath, params.sessionId, params.id, previous);
}

/**
 * The ask-to-fix context package — one structured user message. References, never bulk: the change set
 * is named by sha/paths (the agent reads content with its own tools), the feedback is quoted verbatim,
 * and the instruction pins the fix to THIS item id (the revision must attach to the step it revises —
 * see the todos skill's "Fix requests re-open the SAME item").
 */
export function renderFixPackage(item: StoredItem, feedback: string): string {
	const shas = commitShas(item);
	const paths = (item.artifacts ?? []).flatMap((a) =>
		a.kind === "change" && a.path ? [a.path] : [],
	);
	const changeSet =
		shas.length > 0
			? `commit${shas.length === 1 ? "" : "s"} ${shas.map((s) => s.slice(0, 12)).join(", ")}${paths.length > 0 ? `; uncommitted paths: ${paths.join(", ")}` : ""}`
			: `changed paths: ${paths.join(", ")}`;
	const lines = [
		`The user reviewed your completed step ${item.id} ("${item.title}") and asked for a fix.`,
		"",
		...(item.note ? [`Step note: ${item.note}`] : []),
		...(item.summary ? [`Your completion summary: ${item.summary}`] : []),
		`Change set under review: ${changeSet}`,
		"",
		"User feedback:",
		'"""',
		feedback,
		'"""',
		"",
		`Address the feedback on THIS step: flip ${item.id} back to in_progress (todo_update), make the fix, then mark it done with a fresh summary describing the fix. Do not create a new item for it.`,
	];
	return lines.join("\n");
}
