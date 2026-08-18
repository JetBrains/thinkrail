// Host-owned change-set artifacts: when the agent marks a TODO item `done`, the host commits that item's
// work to the workspace branch and attaches the sha (one `commit` artifact) so the in-chat plan becomes a
// durable review map — the commit's file list and diffs are *derived* from git at read time (see
// `todos.ts`'s listTodos decoration), never denormalized into the JSON. The agent owns status
// (pending → in_progress → done); the host only *observes* the transitions on the pi event stream (see
// host/server.ts) and drives git — the pi-free `TodoStore` and the `pi-todos` extension stay git-free.
//
// Attribution is a delta over a *work window*: when an item enters `in_progress` we snapshot the worktree's
// uncommitted-changed paths + HEAD (its baseline — persisted in a sidecar next to the todos JSON, see
// `baselines.ts`, so a host restart mid-item changes nothing); when it reaches `done` the item's changes are
// the paths changed *since* that baseline.
//
// Commit gate (safety on the user's own branch): a commit may only contain work the item can be *proven* to
// own, so the host commits only with a recorded window, no foreign dirt left (every path dirty at the
// baseline is clean again), a window that never overlapped another chat's, and a non-empty delta — and even
// then it commits only the delta paths. Anything else falls back to live-diff `change` path-list artifacts
// (branch scope). A user's WIP in a Default workspace quietly disables the auto-commit, which is the point.
// The full rationale per condition is on `reconcileChangeArtifacts` below.

import type { PiEvent } from "@thinkrail/contracts";
import { WORKSPACE_INTERNAL_DIR } from "@thinkrail/shared/paths";
import { type TodoArtifact, type TodoPlan, TodoStore } from "pi-todos/core";
import { gitCommitPaths, gitHeadSha, gitStatus } from "../git";
import { getWorkspace } from "../workspaces";
import {
	type Baseline,
	markOtherSessionWindowsShared,
	otherSessionWindows,
	readBaselines,
	writeBaselines,
} from "./baselines";
import { dropReviewRecord } from "./reviews";

/**
 * Commit a done item's work — **exactly `paths`**, the delta the reconcile proved the item owns; returns
 * the sha, or null (nothing to commit / git failed / the user's index was left untouched).
 */
export type CommitWindow = (opts: {
	title: string;
	sessionId: string;
	todoId: string;
	paths: string[];
}) => { sha: string } | null;

/**
 * The host's own on-disk state (`.thinkrail/…`, e.g. the todos JSON under `context/todos/`) is never a
 * change the step *produced* — writing a todo status shows up in `git status`, so without this filter
 * almost every item would get a spurious `change` artifact pointing at the todos file. Worktree-relative
 * posix paths.
 */
const isAppStatePath = (path: string): boolean =>
	path === WORKSPACE_INTERNAL_DIR || path.startsWith(`${WORKSPACE_INTERNAL_DIR}/`);

/** The event that should trigger a reconcile: a `todo_*` tool just finished mutating the plan. */
export function isTodoToolEnd(event: PiEvent): boolean {
	return (
		event.type === "tool_execution_end" &&
		typeof event.toolName === "string" &&
		event.toolName.startsWith("todo_")
	);
}

/** Every item, loose + grouped. */
function flatten(plan: TodoPlan): TodoPlan["todos"] {
	return [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
}

/** The commit message for a done item: a readable subject + a recoverable/squashable attribution trailer. */
function commitMessage(title: string, sessionId: string, todoId: string): string {
	return `todo: ${title}\n\nThinkRail-Todo: ${sessionId}/${todoId}`;
}

/** Per-workspace tail of the reconcile queue — git writes for one workspace never overlap (see below). */
const commitQueues = new Map<string, Promise<void>>();

/**
 * Host-context wrapper: resolve the workspace's store + git, then reconcile. Best-effort — never throws
 * (a git failure or a vanished workspace resolves to a no-op) and never blocks the caller's turn: it runs
 * git writes, so `host/server.ts` fires it off the publish path (`void`). Reconciles are **serialized per
 * workspace** (a promise chain) so two quick `todo_*` ends can't race the index mid-commit. Returns the
 * chained promise so tests/callers can await settlement.
 */
export function maybeAttachChangeArtifacts(workspaceId: string, sessionId: string): Promise<void> {
	const prev = commitQueues.get(workspaceId) ?? Promise.resolve();
	const next = prev.then(() => runReconcile(workspaceId, sessionId));
	commitQueues.set(workspaceId, next);
	// Drop the tail once drained so the map can't grow without bound across a long-lived host.
	void next.finally(() => {
		if (commitQueues.get(workspaceId) === next) commitQueues.delete(workspaceId);
	});
	return next;
}

/**
 * Resolve once the workspace's queued reconciles have drained — the **causal read barrier** behind
 * `listTodos`. A client's only refresh signal is the `pi.event` a `todo_*` tool end publishes, and the
 * reconcile is enqueued *synchronously with that publish* (`host/server.ts`) but settles later (it commits).
 * So a plan read that awaits this can never land in the window where the item is `done` but its change set
 * isn't stored yet — without it, a commit slower than the client's refetch debounce would leave an open plan
 * page promising a change set it doesn't show until some unrelated event. Resolves immediately when nothing
 * is in flight, and never rejects (the reconcile swallows its own failures).
 */
export function settleChangeArtifacts(workspaceId: string): Promise<void> {
	return (commitQueues.get(workspaceId) ?? Promise.resolve()).catch(() => {});
}

function runReconcile(workspaceId: string, sessionId: string): void {
	try {
		const root = getWorkspace(workspaceId).worktreePath;
		const store = new TodoStore(root, sessionId);
		reconcileChangeArtifacts(
			store,
			root,
			sessionId,
			// Uncommitted scope (worktree vs HEAD): the paths a commit here would record. Each committed item
			// leaves this set, so a later item's baseline/delta sees only its own new work.
			() => gitStatus(workspaceId, { kind: "uncommitted" }).changes.map((c) => c.path),
			({ title, todoId, paths }) =>
				gitCommitPaths(workspaceId, commitMessage(title, sessionId, todoId), paths),
			() => gitHeadSha(workspaceId),
		);
	} catch (err) {
		console.warn(
			`todo change-artifacts skipped (${workspaceId}/${sessionId}): ${err instanceof Error ? err.message : err}`,
		);
	}
}

/** True once an item carries a host-attached change set (a `change` list or a `commit`). */
function hasChangeSet(artifacts: TodoArtifact[] | undefined): boolean {
	return artifacts?.some((a) => a.kind === "change" || a.kind === "commit") ?? false;
}

/**
 * The pure reconcile (no workspace registry, no git — injected via `getChangedPaths` + `commit` +
 * `getHead`), so it's testable with a plain `TodoStore` and a temp dir:
 * - an item now `in_progress` with no baseline → snapshot the current changed-path set + HEAD into the
 *   persisted sidecar (`baselines.ts`) — that snapshot *opens the item's work window*;
 * - an item now `done` → **commit its delta** and attach one `commit` (sha) artifact, preserving the
 *   agent's `file`/`spec` artifacts. The commit is gated (see below); when it's skipped or `commit` is
 *   absent we fall back to `change` path-list artifacts for the delta;
 * - an item back to `pending` → drop any stale baseline.
 *
 * The **commit gate** — all four must hold, else the path-list fallback. It exists because a commit on the
 * user's own branch may only contain work this item can be *proven* to own:
 * 1. **A recorded baseline.** No baseline = no observed work window (an item flipped straight to `done`, a
 *    plan that predates the sidecar), and without one every dirty path in the worktree would look like the
 *    item's delta — so unattributable, never committed.
 * 2. **No foreign dirt left.** Every path already dirty at the baseline is clean again by `done`, so
 *    nothing pre-existing can ride along.
 * 3. **A window that was exclusive for its whole life.** It never overlapped *another chat's* window
 *    (`Baseline.shared`, marked at both ends) — every chat in the workspace shares one worktree, so two
 *    open windows can't have their dirt split between them. (Within one plan this can't arise: `pi-todos`
 *    keeps exactly one item `in_progress`, demoting the rest, and a demoted item's window is dropped.)
 * 4. **A non-empty delta** (nothing to record otherwise).
 *
 * Even then the commit records **only the delta paths** (never "everything dirty"), so anything that lands
 * between the status read and the commit stays out of it. What remains unowned is a *user* edit made
 * through a terminal or an external editor inside the window (the app's own editor is read-only): it looks
 * exactly like agent work in `git status`, and is the one accepted hole — see SPEC §Change artifacts.
 *
 * Idempotency & re-do: a `done` item already carrying a change set and with **no fresh baseline** is a
 * steady-state no-op. If it was re-opened and re-worked (so a fresh baseline exists), a new **commit is
 * APPENDED** to the item's existing commit artifacts — the artifact list is the item's revision history
 * (1 TODO = N commits is first-class; the review watermark diffs against it) — while old `change`
 * path-lists are replaced (a live path delta has no history to keep). A redo that lands in the path-list
 * fallback also **drops the item's review record** (reset to `unreviewed`): a live-path delta can't be
 * watermarked by sha, so "review only the new delta" degrades to reviewing the change set afresh. The
 * agent's `file`/`spec` artifacts are always kept.
 *
 * `getChangedPaths` is called lazily and memoized — but the memo is **dropped after each commit**, since
 * committing empties the uncommitted set the next item's delta is measured against (without that, a second
 * item done in the same pass would inherit the first item's already-committed paths). The baseline sidecar
 * is written once at the end, only when something changed.
 */
export function reconcileChangeArtifacts(
	store: TodoStore,
	root: string,
	sessionId: string,
	getChangedPaths: () => string[],
	commit?: CommitWindow,
	getHead: () => string | null = () => null,
): void {
	const plan = store.read();
	const baselines = readBaselines(root, sessionId);
	let baselinesDirty = false;
	const dropBaseline = (id: string): void => {
		if (baselines[id] === undefined) return;
		delete baselines[id];
		baselinesDirty = true;
	};
	let changed: string[] | null = null;
	// Filter app-state paths once, so the baseline snapshot and the done-delta both see the same cleaned
	// set (else a `.thinkrail/` path in the baseline but not the delta, or vice-versa, would skew the math).
	const currentChanged = (): string[] =>
		(changed ??= getChangedPaths().filter((p) => !isAppStatePath(p)));
	// One sidecar scan per pass: nothing inside a pass can open or close another chat's window (marking one
	// shared doesn't change whether it exists), and a long plan would otherwise re-scan per done item.
	let othersOpen: boolean | null = null;
	const otherChatWorking = (): boolean => (othersOpen ??= otherSessionWindows(root, sessionId));

	const items = flatten(plan);
	// Prune orphans first: a baseline whose item no longer exists (removed from the plan, replanned away)
	// is a work window nobody can ever close — left behind, it would read as "open" in every later overlap
	// check and permanently force other chats into the path-list fallback.
	const liveIds = new Set(items.map((t) => t.id));
	for (const id of Object.keys(baselines)) {
		if (!liveIds.has(id)) dropBaseline(id);
	}
	for (const todo of items) {
		if (todo.status === "in_progress") {
			if (!baselines[todo.id]) {
				// Opening a window: record whether it already shares the worktree with another chat, and if so
				// mark the windows it opened beside — whichever opened first recorded itself exclusive and would
				// otherwise still believe it (see `Baseline.shared`).
				const shared = otherChatWorking();
				baselines[todo.id] = {
					paths: currentChanged(),
					head: getHead(),
					...(shared && { shared }),
				};
				if (shared) markOtherSessionWindowsShared(root, sessionId);
				baselinesDirty = true;
			}
			continue;
		}
		if (todo.status !== "done") {
			dropBaseline(todo.id); // pending (e.g. reset) — the baseline is stale
			continue;
		}
		// done:
		const base: Baseline | undefined = baselines[todo.id];
		dropBaseline(todo.id);
		const existing = todo.artifacts ?? [];
		// Already attached and not re-worked since (no fresh baseline) → nothing to do.
		if (hasChangeSet(existing) && base === undefined) continue;
		const now = currentChanged();
		// No baseline → no observed window: every dirty path would look like this item's work, so the delta
		// is the whole current set and it may only ever be *reported* (path-list), never committed.
		const deltaPaths = base ? now.filter((p) => !base.paths.includes(p)) : now;
		if (deltaPaths.length === 0) continue;
		// Re-do: commits ACCUMULATE (the revision history the review watermark diffs against); stale `change`
		// path-lists are replaced. The agent's own file/spec artifacts are always kept.
		const preserved = existing.filter((a) => a.kind !== "change");
		// The gate (see above): a window never shared with another chat, and no other chat mid-work right now.
		// `shared` is what covers an overlap that has already closed; the live re-check is the cheap backstop
		// for a sidecar this host never opened itself (a best-effort mark that failed, a stale file).
		const exclusive = base?.shared !== true && !otherChatWorking();
		const committed =
			commit && base?.paths.every((p) => !now.includes(p)) && exclusive
				? commit({ title: todo.title, sessionId, todoId: todo.id, paths: deltaPaths })
				: null;
		if (committed) {
			// The commit emptied these paths out of the uncommitted set — re-read it for the next item.
			changed = null;
			// One commit artifact — the sha is the change set; files/diffs are derived from it at read time.
			store.update(todo.id, {
				artifacts: [...preserved, { kind: "commit", sha: committed.sha, label: todo.title }],
			});
			continue;
		}
		// Fallback: path-list `change` artifacts for the delta (opened live at branch scope). A path delta
		// can't be watermarked by sha, so any prior review decision is reset (→ unreviewed) — the honest
		// degrade for "review only the new delta" when there is no committed revision to diff against.
		const changes = deltaPaths.map((path): TodoArtifact => ({ kind: "change", path }));
		store.update(todo.id, { artifacts: [...preserved, ...changes] });
		dropReviewRecord(root, sessionId, todo.id);
	}
	if (baselinesDirty) writeBaselines(root, sessionId, baselines);
}
