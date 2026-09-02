import type { PiEvent, ReviewComment, ReviewSnapshot, TodoItem } from "@thinkrail/contracts";
import type { Todo } from "pi-todos/core";
import {
	type AddReviewCommentParams,
	createSession,
	ensureSessionAttached,
	followUpSession,
	getSessionWorkspaceId,
	notifyExtUi,
	type ReflectFindingParams,
	type ReviewVerdictParams,
	setAddReviewCommentHandler,
	setReflectFindingHandler,
	setReviewVerdictHandler,
} from "../agent";
import { getProjects } from "../projects";
import {
	addComment,
	anchorProblem,
	buildSendPackage,
	getReviewSnapshot,
	markCommentsSent,
	rollbackSend,
	setReflection,
} from "../reviews";
import { getConfig } from "../settings";
import {
	approveTodoReview,
	cancelTodoReview,
	clearAllPendingReviews,
	listTodos,
	pinReviewerSession,
	recordAgentChangesRequested,
	renderFixPackage,
	reviewedShaSuperseded,
	reviewerSessionFor,
	startTodoReview,
	todoReviewAutoCycles,
	workerSessionForReviewer,
} from "../todos";
import { getWorkspace, listWorkspaceRecords } from "../workspaces";
import { ackSend } from "./ackSend";
import {
	clearReviewerSessionWorkspaceMapping,
	maybeCleanupStuckReviewSession,
	reviewerWorkerFor,
	setReviewerSessionWorkspaceMapping,
} from "./reviewerSessionMonitor";
import { withReviewLock } from "./reviewLock";
import {
	advanceReviewQueue,
	claimReviewQueue,
	onReviewerSettled,
	onReviewStartFailed,
	onReviewVerdict,
	reviewQueueActive,
	type StartOne,
	seedReviewQueue,
} from "./reviewQueue";

interface ItemRef {
	workspaceId: string;
	sessionId: string;
	id: string;
}

const currentReview = new Map<string, { todoId: string; reviewedSha: string; sessionId: string }>();
const activeFixItems = new Set<string>();
const activeFixKey = (sessionId: string, todoId: string): string =>
	[sessionId, todoId].join("\u0000");

export function claimItemFix(sessionId: string, todoId: string): boolean {
	const key = activeFixKey(sessionId, todoId);
	if (activeFixItems.has(key)) return false;
	activeFixItems.add(key);
	return true;
}

export function releaseItemFix(sessionId: string, todoId: string): void {
	activeFixItems.delete(activeFixKey(sessionId, todoId));
}

/** See host/SPEC.md (todo.remove) — covers the tail past `review_verdict` that the durable `pending` mark can't. */
export function isItemUnderActiveReview(sessionId: string, id: string): boolean {
	if (activeFixItems.has(activeFixKey(sessionId, id))) return true;
	for (const entry of currentReview.values()) {
		if (entry.sessionId === sessionId && entry.todoId === id) return true;
	}
	return false;
}

const inFlightReview = new Map<string, string>();
const workerKey = (workspaceId: string, sessionId: string): string =>
	[workspaceId, sessionId].join("\u0000");

interface PendingFix {
	workspaceId: string;
	workerSessionId: string;
	reviewerSessionId: string;
	item: Todo;
	note: string;
	candidateIds: string[];
}

const pendingFix = new Map<string, PendingFix>();

const DEFAULT_FIX_NOTE = "Address the reviewer's comments below.";

function reviewSessionOptions() {
	const cfg = getConfig();
	return {
		...(cfg.reviewModel ? { model: cfg.reviewModel, modelOptional: true } : {}),
		...(cfg.reviewEffort ? { thinkingLevel: cfg.reviewEffort } : {}),
	};
}

export type SendReviewPackage = (sessionId: string, pkg: string) => Promise<void>;

export async function startTodoReviewFlow(
	p: ItemRef,
	sendReviewPackage: SendReviewPackage = followUpSession,
	opts: { fromQueue?: boolean } = {},
): Promise<{ ok: true; reviewerSessionId: string }> {
	const key = workerKey(p.workspaceId, p.sessionId);
	// A manual start must not slip in during Review All's claim→listTodos gap (see host/SPEC.md) —
	// the queue's own advance calls this with fromQueue:true and skips the check.
	if (!opts.fromQueue && reviewQueueActive(p.workspaceId, p.sessionId)) {
		throw new Error("Review All is running for this plan — one review at a time.");
	}
	const inFlight = inFlightReview.get(key);
	if (inFlight !== undefined) {
		throw new Error(
			inFlight === p.id
				? "This step is already being reviewed."
				: "A review is already running for this plan — one review at a time.",
		);
	}
	inFlightReview.set(key, p.id);
	const ws = getWorkspace(p.workspaceId);
	try {
		// Render first (validates the item + marks it pending); any failure below must clear the mark.
		const { pkg, reviewedSha } = startTodoReview(p);
		const pinned = reviewerSessionFor(p);
		let reviewerSessionId: string;
		if (pinned && (await ensureSessionAttached(pinned, p.workspaceId, ws.worktreePath))) {
			reviewerSessionId = pinned;
		} else {
			if (pinned) {
				clearReviewerSessionWorkspaceMapping(pinned);
				currentReview.delete(pinned);
			}
			const created = await createSession({
				cwd: ws.worktreePath,
				workspaceId: p.workspaceId,
				...reviewSessionOptions(),
			});
			pinReviewerSession(p, created.sessionId);
			reviewerSessionId = created.sessionId;
		}
		currentReview.set(reviewerSessionId, { todoId: p.id, reviewedSha, sessionId: p.sessionId });
		setReviewerSessionWorkspaceMapping(reviewerSessionId, p.workspaceId, p.sessionId);
		fireReviewerPrompt(p, reviewerSessionId, pkg, sendReviewPackage);
		return { ok: true, reviewerSessionId };
	} catch (err) {
		inFlightReview.delete(key);
		cancelTodoReview(p);
		throw err;
	}
}

function isFindingStale(workspaceId: string, comment: ReviewComment): boolean {
	const origin = comment.origin;
	return (
		comment.anchorState === "outdated" &&
		origin !== undefined &&
		reviewedShaSuperseded(
			{ workspaceId, sessionId: origin.sessionId, id: origin.todoId },
			origin.reviewedSha,
		)
	);
}

export function markClientStale<T extends ReviewSnapshot>(snapshot: T, workspaceId: string): T {
	return {
		...snapshot,
		comments: snapshot.comments.map((c) =>
			isFindingStale(workspaceId, c) ? { ...c, stale: true } : c,
		),
	};
}

async function itemFindings(p: ItemRef): Promise<ReviewComment[]> {
	return (await getReviewSnapshot(p.workspaceId)).comments.filter(
		(c) =>
			c.author === "agent" &&
			c.origin?.todoId === p.id &&
			c.origin.sessionId === p.sessionId &&
			!isFindingStale(p.workspaceId, c),
	);
}

export async function itemFixFindings(p: ItemRef): Promise<ReviewComment[]> {
	return (await itemFindings(p)).filter((c) => c.status === "draft");
}

export async function itemOpenFindings(p: ItemRef): Promise<ReviewComment[]> {
	return (await itemFindings(p)).filter(
		(c) => (c.status === "draft" || c.status === "sent") && c.reflection?.verdict !== "refuted",
	);
}

/** Mirrors the client's `planView.reviewSettled` — keep the two in sync, see host/SPEC.md. */
function isReviewSettled(item: TodoItem): boolean {
	const r = item.review;
	return r !== undefined && r.state === "reviewed" && (r.unreviewedShas?.length ?? 0) === 0;
}

const startOneReview =
	(workspaceId: string, sessionId: string): StartOne =>
	(id: string) =>
		startTodoReviewFlow({ workspaceId, sessionId, id }, undefined, { fromQueue: true });

export async function startReviewAllFlow(p: {
	workspaceId: string;
	sessionId: string;
}): Promise<{ ok: true; total: number; alreadyRunning?: true }> {
	// Claimed BEFORE the first await, same as claimReviewQueue below — a manual start that already
	// holds this latch must report alreadyRunning too, not race claimReviewQueue and lose every
	// queued item to the same conflict (see host/SPEC.md).
	if (inFlightReview.has(workerKey(p.workspaceId, p.sessionId)))
		return { ok: true, total: 0, alreadyRunning: true };
	if (!claimReviewQueue(p.workspaceId, p.sessionId))
		return { ok: true, total: 0, alreadyRunning: true };
	try {
		const plan = await listTodos(p);
		const items = [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
		const pending = items
			.filter((t) => t.review !== undefined && !isReviewSettled(t) && t.review.reviewing !== true)
			.map((t) => t.id);
		seedReviewQueue(p.workspaceId, p.sessionId, pending);
		if (pending.length === 0) return { ok: true, total: 0 };
		await advanceReviewQueue(
			p.workspaceId,
			p.sessionId,
			startOneReview(p.workspaceId, p.sessionId),
		);
		return { ok: true, total: pending.length };
	} catch (err) {
		seedReviewQueue(p.workspaceId, p.sessionId, []);
		throw err;
	}
}

function fireReviewerPrompt(
	p: ItemRef,
	reviewerSessionId: string,
	pkg: string,
	sendReviewPackage: SendReviewPackage,
): void {
	void ackSend(sendReviewPackage(reviewerSessionId, pkg))
		.then(undefined, (err) => {
			inFlightReview.delete(workerKey(p.workspaceId, p.sessionId));
			currentReview.delete(reviewerSessionId);
			cancelTodoReview(p);
			notifyExtUi(
				reviewerSessionId,
				`Review start failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
			onReviewStartFailed(
				p.workspaceId,
				p.sessionId,
				p.id,
				startOneReview(p.workspaceId, p.sessionId),
			);
		})
		.catch((err) => {
			console.warn(`todo review cancel failed: ${err instanceof Error ? err.message : err}`);
		});
}

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

export function handleReviewerSettled(sessionId: string, event: PiEvent): void {
	if (event.type !== "agent_settled") return;
	const mapping = reviewerWorkerFor(sessionId);
	const cleared = maybeCleanupStuckReviewSession(sessionId, event);
	if (cleared) {
		currentReview.delete(sessionId);
		inFlightReview.delete(workerKey(cleared.workspaceId, cleared.sessionId));
		for (const id of cleared.itemIds) {
			onReviewStartFailed(
				cleared.workspaceId,
				cleared.sessionId,
				id,
				startOneReview(cleared.workspaceId, cleared.sessionId),
			);
		}
	}
	if (!mapping) return;
	const key = workerKey(mapping.workspaceId, mapping.sessionId);
	if (!cleared) {
		const own = currentReview.get(sessionId);
		currentReview.delete(sessionId);
		if (own !== undefined && inFlightReview.get(key) === own.todoId) {
			inFlightReview.delete(key);
		}
	}
	onReviewerSettled(
		mapping.workspaceId,
		mapping.sessionId,
		startOneReview(mapping.workspaceId, mapping.sessionId),
	);
	// !cleared: a crash settle must never restart the automation — see host/SPEC.md.
	if (!cleared && !inFlightReview.has(key))
		void maybeAutoReReview(mapping.workspaceId, mapping.sessionId);
}

export function installTodoReviewSeams(): void {
	setAddReviewCommentHandler((reviewerSessionId, params: AddReviewCommentParams) => {
		const { workspaceId } = reviewerContext(reviewerSessionId);
		return withReviewLock(workspaceId, async () => {
			const problem = anchorProblem(workspaceId, params.path, params.startLine);
			if (problem) throw new Error(problem);
			const endLine = params.endLine ?? params.startLine;
			const origin = currentReview.get(reviewerSessionId);
			if (!origin)
				throw new Error(
					"add_review_comment: no review is in flight for this session — the reviewer chat has already settled.",
				);
			const comment = await addComment({
				workspaceId,
				kind: "inline",
				author: "agent",
				body: params.body,
				origin,
				anchor: {
					path: params.path,
					side: "worktree",
					contentHash: "",
					selectors: [{ kind: "lineRange", startLine: params.startLine, endLine }],
				},
			});
			return { commentId: comment.id };
		});
	});

	setReviewVerdictHandler((reviewerSessionId, params: ReviewVerdictParams) => {
		const ctx = reviewerContext(reviewerSessionId);
		return withReviewLock(ctx.workspaceId, async () => {
			const current = currentReview.get(reviewerSessionId);
			if (!current || current.todoId !== params.todoId) {
				throw new Error(
					current
						? `review_verdict: this session is reviewing ${current.todoId} — a verdict for ${params.todoId} would land on the wrong item.`
						: "review_verdict: no review is in flight for this session.",
				);
			}
			const ref: ItemRef = {
				workspaceId: ctx.workspaceId,
				sessionId: current.sessionId,
				id: current.todoId,
			};
			const settleQueue = () => onReviewVerdict(ctx.workspaceId, current.sessionId, current.todoId);
			if (params.verdict === "approve") {
				const open = await itemOpenFindings(ref);
				if (open.length > 0) {
					throw new Error(
						`review_verdict: ${params.todoId} still has ${open.length} open finding(s) on it ` +
							`(ids: ${open.map((c) => c.id).join(", ")}) — the worker resolves each one after ` +
							`addressing it, or you can call review_verdict with verdict: "request_changes" instead.`,
					);
				}
				approveTodoReview(ref, "agent");
				settleQueue();
				return {
					summary: `Verdict recorded: ${params.todoId} approved — the item is now reviewed.`,
				};
			}
			const autoFix = getConfig().reviewAutoFix !== false;
			const spent = todoReviewAutoCycles(ref) ?? 0;
			if (spent >= 1 || !autoFix) {
				recordAgentChangesRequested({
					...ref,
					...(params.note ? { note: params.note } : {}),
					autoCycles: 2,
				});
				settleQueue();
				return {
					summary: autoFix
						? `Verdict recorded: changes requested on ${params.todoId}. The automated fix cycle is spent — the user decides next.`
						: `Verdict recorded: changes requested on ${params.todoId}. Auto-fix is off — the findings await the user.`,
				};
			}
			const note = params.note ?? DEFAULT_FIX_NOTE;
			if (!claimItemFix(current.sessionId, current.todoId))
				throw new Error(`A fix request is already active for ${current.todoId}.`);
			let candidates: ReviewComment[];
			try {
				candidates = await itemFixFindings(ref);
			} catch (error) {
				releaseItemFix(current.sessionId, current.todoId);
				throw error;
			}
			let item: Todo;
			try {
				({ item } = recordAgentChangesRequested({
					...ref,
					...(params.note ? { note: params.note } : {}),
					autoCycles: 1,
				}));
			} catch (error) {
				releaseItemFix(current.sessionId, current.todoId);
				throw error;
			}
			const pending: PendingFix = {
				workspaceId: ctx.workspaceId,
				workerSessionId: ctx.sessionId,
				reviewerSessionId,
				item,
				note,
				candidateIds: candidates.map((c) => c.id),
			};
			settleQueue();
			if (candidates.length === 0) {
				void sendReflectedFix(pending);
				return {
					summary: `Verdict recorded: changes requested on ${params.todoId} — no findings to send (auto cycle 1 of 1).`,
				};
			}
			fireReflection(pending, candidates);
			return {
				summary: `Verdict recorded: changes requested on ${params.todoId} — reflecting ${candidates.length} finding(s) before the fix request (auto cycle 1 of 1).`,
			};
		});
	});

	setReflectFindingHandler((reflectorSessionId, params: ReflectFindingParams) => {
		const pending = pendingFix.get(reflectorSessionId);
		if (!pending)
			throw new Error("reflect_finding is only for the reflector session of an active fix cycle.");
		return withReviewLock(pending.workspaceId, async () => {
			if (pendingFix.get(reflectorSessionId) !== pending)
				throw new Error(
					"reflect_finding is only for the reflector session of an active fix cycle.",
				);
			if (!pending.candidateIds.includes(params.commentId))
				throw new Error(
					`reflect_finding: ${params.commentId} is not one of this reflection's candidate findings.`,
				);
			const comment = await setReflection(pending.workspaceId, params.commentId, {
				verdict: params.verdict,
				confidence: params.confidence,
				reason: params.reason,
			});
			return { body: comment.body };
		});
	});
}

function renderReflectionPackage(item: Todo, candidates: ReviewComment[]): string {
	const lines = candidates.map((c) => {
		const range = c.anchor?.selectors.find((s) => s.kind === "lineRange");
		const where = c.anchor?.path
			? `${c.anchor.path}${range ? `:${range.startLine}${range.endLine !== range.startLine ? `-${range.endLine}` : ""}` : ""}`
			: "(no file)";
		return `- [${c.id}] ${where}\n  ${c.body.replace(/\n/g, "\n  ")}`;
	});
	return [
		`You are the REFLECTOR for plan step ${item.id} ("${item.title}"). Another agent filed the findings`,
		"below while reviewing its change set; judge each against the real code before it becomes a fix request.",
		"",
		"FIRST read the reflecting-findings skill and follow it exactly — it defines how to verify a finding,",
		"why the default under doubt is refuted, and that each finding ends with exactly one reflect_finding.",
		"",
		"Findings to reflect on:",
		...lines,
	].join("\n");
}

async function sendReflectedFix(pending: PendingFix): Promise<void> {
	try {
		const prepared = await withReviewLock(pending.workspaceId, async () => {
			const ids = new Set(pending.candidateIds);
			const surviving = (await getReviewSnapshot(pending.workspaceId)).comments.filter(
				(c) => ids.has(c.id) && c.status === "draft" && c.reflection?.verdict !== "refuted",
			);
			if (pending.candidateIds.length > 0 && surviving.length === 0) return null;
			const survivingIds = surviving.map((c) => c.id);
			const reviewPackage =
				survivingIds.length > 0 ? await buildSendPackage(pending.workspaceId, surviving) : null;
			if (survivingIds.length > 0)
				await markCommentsSent(pending.workspaceId, survivingIds, pending.workerSessionId);
			const fixText = reviewPackage
				? `${renderFixPackage(pending.item, pending.note)}\n\n${reviewPackage}`
				: renderFixPackage(pending.item, pending.note);
			return { survivingIds, fixText };
		});
		if (!prepared) {
			recordAgentChangesRequested({
				workspaceId: pending.workspaceId,
				sessionId: pending.workerSessionId,
				id: pending.item.id,
				note: pending.note,
				autoCycles: 2,
			});
			notifyExtUi(
				pending.reviewerSessionId,
				"Every finding was refuted on reflection — no fix was sent. They stay in Review for you to judge.",
				"info",
			);
			releaseItemFix(pending.workerSessionId, pending.item.id);
			return;
		}
		void ackSend(followUpSession(pending.workerSessionId, prepared.fixText))
			.then(undefined, (err) => {
				if (prepared.survivingIds.length > 0)
					rollbackSend(pending.workspaceId, prepared.survivingIds, pending.workerSessionId);
				notifyExtUi(
					pending.reviewerSessionId,
					`Fix send failed: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			})
			.catch((err) => {
				console.warn(`reflected fix rollback failed: ${err instanceof Error ? err.message : err}`);
			})
			.finally(() => releaseItemFix(pending.workerSessionId, pending.item.id));
	} catch (err) {
		releaseItemFix(pending.workerSessionId, pending.item.id);
		console.warn(`reflected fix send skipped: ${err instanceof Error ? err.message : err}`);
	}
}

function fireReflection(pending: PendingFix, candidates: ReviewComment[]): void {
	const ws = getWorkspace(pending.workspaceId);
	void (async () => {
		const reflector = await createSession({
			cwd: ws.worktreePath,
			workspaceId: pending.workspaceId,
			...reviewSessionOptions(),
		});
		pendingFix.set(reflector.sessionId, pending);
		try {
			await ackSend(
				followUpSession(reflector.sessionId, renderReflectionPackage(pending.item, candidates)),
			);
		} catch (err) {
			pendingFix.delete(reflector.sessionId);
			void sendReflectedFix(pending);
			notifyExtUi(
				pending.reviewerSessionId,
				`Reflection couldn't start (${err instanceof Error ? err.message : String(err)}) — the fix was sent unreflected.`,
				"warning",
			);
		}
	})().catch(() => sendReflectedFix(pending));
}

export function maybeResumeReflection(settledSessionId: string): void {
	const pending = pendingFix.get(settledSessionId);
	if (!pending) return;
	pendingFix.delete(settledSessionId);
	void sendReflectedFix(pending);
}

export async function maybeAutoReReview(workspaceId: string, sessionId: string): Promise<void> {
	if (inFlightReview.has(workerKey(workspaceId, sessionId))) return;
	try {
		const plan = await listTodos({ workspaceId, sessionId });
		const items = [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
		for (const item of items) {
			const r = item.review;
			if (r?.reviewing || item.status !== "done") continue;
			if (todoReviewAutoCycles({ workspaceId, sessionId, id: item.id }) !== 1) continue;
			const freshCommitDelta =
				r?.state === "changes_requested" && (r.unreviewedShas?.length ?? 0) > 0;
			// r?.state === "unreviewed" is the path-list fallback's record reset (todos/artifacts.ts) —
			// autoCycles: 1 can only survive that reset for an item genuinely mid-auto-cycle, so it is
			// itself the "new delta since the fix request" signal a path-list item has no sha to carry.
			if (!freshCommitDelta && r?.state !== "unreviewed") continue;
			await startTodoReviewFlow({ workspaceId, sessionId, id: item.id });
		}
	} catch (err) {
		console.warn(`auto re-review skipped (${workspaceId}/${sessionId}): ${err}`);
	}
}

/** Boot-time host-restart reconciliation — see host/SPEC.md ("reconcilePendingReviewsOnBoot"). */
export function reconcilePendingReviewsOnBoot(): void {
	for (const project of getProjects()) {
		for (const ws of listWorkspaceRecords(project.id)) {
			for (const { sessionId, itemIds } of clearAllPendingReviews(ws.worktreePath)) {
				console.warn(
					`review: cleared ${itemIds.length} stale pending mark(s) from a previous host run ` +
						`(workspace ${ws.id}, session ${sessionId}): ${itemIds.join(", ")}`,
				);
			}
		}
	}
}
