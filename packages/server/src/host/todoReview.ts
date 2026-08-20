// The agent-reviewer orchestration (task-agent-reviewer) — a host composition over `todos` (records,
// packages, reviewer pin), `reviews` (the findings live as agent-authored review comments), and `agent`
// (sessions + the two tool seams). Flow: `todo.startReview` fires the review package into the plan's
// dedicated reviewer chat; the reviewer records findings via `add_review_comment` (Review tab, live) and
// settles with `review_verdict` — approve records the item reviewed-by-agent; request_changes triggers
// ONE automated fix cycle (comments → the worker chat via the same send package human reviews use; the
// fixed revision auto-fires one re-review), then everything waits for the human. Manual buttons stay the
// override at every stage.

import type { TodoItem } from "@thinkrail/contracts";
import {
	type AddReviewCommentParams,
	createSession,
	ensureSessionAttached,
	followUpSession,
	getSessionWorkspaceId,
	notifyExtUi,
	type ReviewVerdictParams,
	setAddReviewCommentHandler,
	setReviewVerdictHandler,
} from "../agent";
import { addComment, buildSendPackage, getReviewSnapshot, markCommentsSent } from "../reviews";
import {
	approveTodoReview,
	cancelTodoReview,
	listTodos,
	pinReviewerSession,
	recordAgentChangesRequested,
	renderFixPackage,
	reviewerSessionFor,
	startTodoReview,
	todoReviewRecord,
	workerSessionForReviewer,
} from "../todos";
import { getWorkspace } from "../workspaces";
import { ackSend } from "./ackSend";
import { advanceReviewQueue, onReviewVerdict, type StartOne, seedReviewQueue } from "./reviewQueue";

/** Ids the flow needs everywhere: the workspace, the WORKER chat (the plan's owner), and the item. */
interface ItemRef {
	workspaceId: string;
	sessionId: string;
	id: string;
}

/**
 * Start the agent review of one reviewable item: ensure the plan's reviewer chat (pinned in the review
 * sidecar; created on first use, re-attached from disk when not live), mark the item `reviewing`, and
 * fire the package DETACHED (the review-send pattern) — a pre-turn rejection clears the mark and
 * surfaces inside the reviewer chat, so an undelivered review never spins forever.
 */
export async function startTodoReviewFlow(
	p: ItemRef,
): Promise<{ ok: true; reviewerSessionId: string }> {
	const ws = getWorkspace(p.workspaceId);
	// Render first (validates the item + marks it pending); any failure below must clear the mark.
	const { pkg } = startTodoReview(p);
	try {
		const pinned = reviewerSessionFor(p);
		if (pinned && (await ensureSessionAttached(pinned, p.workspaceId, ws.worktreePath))) {
			fireReviewerPrompt(p, pinned, pkg);
			return { ok: true, reviewerSessionId: pinned };
		}
		const created = await createSession({ cwd: ws.worktreePath, workspaceId: p.workspaceId });
		pinReviewerSession(p, created.sessionId);
		fireReviewerPrompt(p, created.sessionId, pkg);
		return { ok: true, reviewerSessionId: created.sessionId };
	} catch (err) {
		cancelTodoReview(p);
		throw err;
	}
}

/** Host mirror of the client's `planView.reviewSettled`: approved AND no unreviewed delta. */
function isReviewSettled(item: TodoItem): boolean {
	const r = item.review;
	return r !== undefined && r.state === "reviewed" && (r.unreviewedShas?.length ?? 0) === 0;
}

/** The queue's per-item effect: kick one item's agent review (the reviewQueue's injected `startOne`). */
const startOneReview =
	(workspaceId: string, sessionId: string): StartOne =>
	(id: string) =>
		startTodoReviewFlow({ workspaceId, sessionId, id });

/**
 * Start a Review All pass (task-plan-review-kebab): seed the host-side queue with every reviewable item
 * that isn't already settled or in-flight (plan order), then kick the first — the rest follow one at a
 * time as verdicts land (`onReviewVerdict`). Returns how many items were queued (0 = nothing to do).
 */
export async function startReviewAllFlow(p: {
	workspaceId: string;
	sessionId: string;
}): Promise<{ ok: true; total: number }> {
	const plan = await listTodos(p);
	const items = [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
	const pending = items
		.filter((t) => t.review !== undefined && !isReviewSettled(t) && t.review.reviewing !== true)
		.map((t) => t.id);
	seedReviewQueue(p.workspaceId, p.sessionId, pending);
	if (pending.length === 0) return { ok: true, total: 0 };
	await advanceReviewQueue(p.workspaceId, p.sessionId, startOneReview(p.workspaceId, p.sessionId));
	return { ok: true, total: pending.length };
}

/** Detached delivery: a pre-turn rejection clears the `reviewing` mark + surfaces in the reviewer chat. */
function fireReviewerPrompt(p: ItemRef, reviewerSessionId: string, pkg: string): void {
	void ackSend(followUpSession(reviewerSessionId, pkg))
		.then(undefined, (err) => {
			cancelTodoReview(p);
			notifyExtUi(
				reviewerSessionId,
				`Review start failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
		})
		.catch((err) => {
			console.warn(`todo review cancel failed: ${err instanceof Error ? err.message : err}`);
		});
}

/** Resolve the calling reviewer session back to (workspace, worker plan) — the verdict seam's context. */
function reviewerContext(reviewerSessionId: string): { workspaceId: string; sessionId: string } {
	const workspaceId = getSessionWorkspaceId(reviewerSessionId);
	if (!workspaceId) throw new Error("This session is not attached to a workspace.");
	const sessionId = workerSessionForReviewer(workspaceId, reviewerSessionId);
	if (!sessionId)
		throw new Error(
			"This chat is not a plan's reviewer — review_verdict/add_review_comment are for reviewer chats started by todo.startReview.",
		);
	return { workspaceId, sessionId };
}

/** Install the two reviewer-tool seams (host boot, next to `setReviewCommentHandler`). */
export function installTodoReviewSeams(): void {
	setAddReviewCommentHandler((reviewerSessionId, params: AddReviewCommentParams) => {
		const { workspaceId } = reviewerContext(reviewerSessionId);
		const endLine = params.endLine ?? params.startLine;
		const comment = addComment({
			workspaceId,
			kind: "inline",
			author: "agent",
			body: params.body,
			anchor: {
				path: params.path,
				side: "worktree",
				contentHash: "",
				selectors: [{ kind: "lineRange", startLine: params.startLine, endLine }],
			},
		});
		return { commentId: comment.id };
	});

	setReviewVerdictHandler((reviewerSessionId, params: ReviewVerdictParams) => {
		const ctx = reviewerContext(reviewerSessionId);
		const ref: ItemRef = { ...ctx, id: params.todoId };
		if (params.verdict === "approve") {
			approveTodoReview(ref, "agent");
			onReviewVerdict(
				ctx.workspaceId,
				ctx.sessionId,
				params.todoId,
				startOneReview(ctx.workspaceId, ctx.sessionId),
			);
			return { summary: `Verdict recorded: ${params.todoId} approved — the item is now reviewed.` };
		}
		const spent = todoReviewRecord(ref)?.autoCycles ?? 0;
		if (spent >= 1) {
			// The one automated cycle is used up — record the verdict terminally (autoCycles: 2 stops the
			// re-review trigger for good) and leave the decision to the human.
			recordAgentChangesRequested({
				...ref,
				...(params.note ? { note: params.note } : {}),
				autoCycles: 2,
			});
			onReviewVerdict(
				ctx.workspaceId,
				ctx.sessionId,
				params.todoId,
				startOneReview(ctx.workspaceId, ctx.sessionId),
			);
			return {
				summary: `Verdict recorded: changes requested on ${params.todoId}. The automated fix cycle is spent — the user decides next.`,
			};
		}
		const { item } = recordAgentChangesRequested({
			...ref,
			...(params.note ? { note: params.note } : {}),
			autoCycles: 1,
		});
		// ONE automated fix cycle: the reviewer's own unresolved comments ride the SAME send package a
		// human review send produces, framed as this item's fix request, into the WORKER chat.
		const comments = getReviewSnapshot(ctx.workspaceId).comments.filter(
			(c) => c.author === "agent" && c.status === "draft",
		);
		let fixText = renderFixPackage(item, params.note ?? "Address the reviewer's comments below.");
		if (comments.length > 0) {
			markCommentsSent(
				ctx.workspaceId,
				comments.map((c) => c.id),
				ctx.sessionId,
			);
			fixText += `\n\n${buildSendPackage(ctx.workspaceId, comments)}`;
		}
		void ackSend(followUpSession(ctx.sessionId, fixText)).catch((err) => {
			notifyExtUi(
				reviewerSessionId,
				`Fix send failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
		});
		// Review All advances immediately on a changes_requested verdict — the fix + auto-re-review runs
		// in the background (task-plan-review-kebab): a single pass over everything, never blocking on the
		// worker's fix.
		onReviewVerdict(
			ctx.workspaceId,
			ctx.sessionId,
			params.todoId,
			startOneReview(ctx.workspaceId, ctx.sessionId),
		);
		return {
			summary: `Verdict recorded: changes requested on ${params.todoId} — your ${comments.length} comment(s) were sent to the worker chat as a fix request (auto cycle 1 of 1).`,
		};
	});
}

/**
 * The auto RE-review: called after each reconcile settles (the worker's `todo_*` writes). An item whose
 * agent verdict was `changes_requested` with exactly one spent cycle and whose artifact list has grown
 * past the watermark (the fix landed) gets ONE re-review; its verdict — whatever it is — ends the
 * automation (the record then carries `autoCycles: 2` via the verdict path's `spent >= 1` branch, and
 * this trigger requires `autoCycles === 1` plus a fresh delta). Best-effort; never throws.
 */
export async function maybeAutoReReview(workspaceId: string, sessionId: string): Promise<void> {
	try {
		const plan = await listTodos({ workspaceId, sessionId });
		const items = [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
		for (const item of items) {
			const r = item.review;
			if (r?.state !== "changes_requested" || r.reviewing) continue;
			if ((r.unreviewedShas?.length ?? 0) === 0 || item.status !== "done") continue;
			const record = todoReviewRecord({ workspaceId, sessionId, id: item.id });
			if (record?.autoCycles !== 1) continue;
			await startTodoReviewFlow({ workspaceId, sessionId, id: item.id });
		}
	} catch (err) {
		console.warn(`auto re-review skipped (${workspaceId}/${sessionId}): ${err}`);
	}
}
