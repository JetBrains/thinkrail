import type {
	PlanReviewResult,
	ReviewComment,
	ReviewFailedPayload,
	ReviewFixComment,
} from "@thinkrail/contracts";
import { isPlanReviewResult } from "@thinkrail/contracts";
import type { Todo } from "pi-todos/core";
import {
	getDefaultModel,
	getSessionWorkspaceId,
	notifyExtUi,
	runReviewSubagent,
	sendReviewFixToSession,
	setRequestReviewHandler,
} from "../agent";
import {
	addComment,
	anchorProblem,
	buildReviewFixDetails,
	buildSendPackage,
	deleteComment,
	getReviewSnapshot,
	markCommentsSent,
	publishReview,
	rollbackSend,
} from "../reviews";
import { getConfig } from "../settings";
import {
	approveTodoReview,
	cancelTodoReview,
	listTodos,
	recordAgentChangesRequested,
	renderFixPackage,
	settleChangeArtifacts,
	startTodoReview,
	todoReviewAutoCycles,
} from "../todos";
import { ackSend } from "./ackSend";
import {
	claimItemReview,
	enqueuePlanReview,
	itemReviewActive,
	onPlanChain,
	releaseItemReview,
} from "./planReviewQueue";
import { additionalCapture, captureAdditional } from "./productAnalytics";
import { REVIEWER_OUTPUT_CONTRACT, REVIEWER_SYSTEM_PROMPT, REVIEWER_TOOLS } from "./reviewerRole";
import { withReviewLock } from "./reviewLock";
import { claimItemFix, itemFixFindings, itemOpenFindings, releaseItemFix } from "./todoReview";

const DEFAULT_FIX_NOTE = "Address the reviewer's findings below.";

let reviewFailedPublisher: (payload: ReviewFailedPayload) => void = () => {};
export function setReviewFailedPublisher(fn: (payload: ReviewFailedPayload) => void): void {
	reviewFailedPublisher = fn;
}

type ReviewParams = { workspaceId: string; sessionId: string; id: string };

/** Resolve an item's display title across every plan collection — stored todos, grouped todos, AND
 * wire-only `adoptedCommits` (a Review-All target the plan never stored) — so a result card or a
 * detached-review failure toast names the commit subject, not the opaque `commit:<sha>` id. Falls back
 * to the id when nothing matches. */
export function itemTitleOf(
	workspaceId: string,
	sessionId: string,
	itemId: string,
): Promise<string> {
	return listTodos({ workspaceId, sessionId }).then((plan) => {
		const all = [
			...plan.todos,
			...plan.groups.flatMap((g) => g.todos),
			...(plan.adoptedCommits ?? []),
		];
		return all.find((t) => t.id === itemId)?.title ?? itemId;
	});
}

export function parseVerdict(
	finalText: string | undefined,
	itemId: string,
	itemTitle: string,
): PlanReviewResult | null {
	if (!finalText) return null;
	const fenced = /```json\s*([\s\S]*?)```/gi.exec(finalText);
	const raw = fenced?.[1] ?? finalText;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw.trim());
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const candidate = { ...(parsed as object), itemId, itemTitle };
	if (!isPlanReviewResult(candidate)) return null;
	const findings: ReviewFixComment[] = candidate.findings.map((f) => ({
		id: f.id,
		kind: f.kind ?? "inline",
		body: f.body,
		...(f.path ? { path: f.path } : {}),
		...(f.startLine !== undefined ? { startLine: f.startLine } : {}),
		...(f.endLine !== undefined ? { endLine: f.endLine } : {}),
	}));
	// Construct explicitly, never spread the model object: `blockedByOpenFindings` is host-set only, so a
	// hallucinated value must not survive an approve. See planReview.SPEC.md.
	return {
		verdict: candidate.verdict,
		itemId,
		itemTitle,
		...(candidate.summary !== undefined ? { summary: candidate.summary } : {}),
		findings,
	};
}

export type VerdictOutcome =
	| { kind: "approved" }
	| { kind: "approve-blocked"; openFindings: number }
	| { kind: "changes"; canAutoFix: boolean; findings?: ReviewFixComment[] };

export function composeText(result: PlanReviewResult, outcome: VerdictOutcome): string {
	const list = outcome.kind === "changes" ? (outcome.findings ?? result.findings) : result.findings;
	const findings =
		list.length > 0
			? `\n\n${list
					.map((f) => {
						const loc = f.path
							? ` (${f.path}${f.startLine ? `:${f.startLine}${f.endLine && f.endLine !== f.startLine ? `-${f.endLine}` : ""}` : ""})`
							: "";
						return `- [${f.id}]${loc} ${f.body}`;
					})
					.join("\n")}`
			: "";
	const rationale = result.summary ? `\n\n${result.summary}` : "";
	if (outcome.kind === "approved") {
		return `Review verdict: APPROVE — step "${result.itemTitle}".${rationale}${findings}`;
	}
	if (outcome.kind === "approve-blocked") {
		const n = outcome.openFindings;
		return (
			`Review verdict: APPROVE — step "${result.itemTitle}" — but it is NOT settled: ` +
			`${n} earlier finding${n === 1 ? "" : "s"} on this step ${n === 1 ? "is" : "are"} still open in Review. ` +
			`Resolve each one you actually addressed with resolve_comment, then request_review again.${rationale}${findings}`
		);
	}
	const head = `Review verdict: REQUEST_CHANGES — step "${result.itemTitle}".`;
	const next = outcome.canAutoFix
		? "Address each finding below (re-open the step, fix it, mark it done with a fresh commit), then request_review again."
		: "The automated fix cycle is spent or auto-fix is off: do NOT fix now. Report these findings to the user and wait for their direction.";
	return `${head} ${next}${rationale}${findings}`;
}

/** File a reviewer finding into the Review tab (an inline comment when it anchors, else review-level).
 * Anchor resolution is best-effort — a bad anchor falls back to a review-level comment — but a store-write
 * failure propagates so the caller cancels the review rather than dropping the finding. See host/SPEC.md. */
async function fileFinding(
	params: ReviewParams,
	reviewedSha: string,
	f: ReviewFixComment,
): Promise<ReviewComment> {
	const origin = { todoId: params.id, reviewedSha, sessionId: params.sessionId };
	if (f.path && f.startLine && !anchorProblem(params.workspaceId, f.path, f.startLine)) {
		return addComment({
			workspaceId: params.workspaceId,
			kind: "inline",
			author: "agent",
			body: f.body,
			origin,
			anchor: {
				path: f.path,
				side: "worktree",
				contentHash: "",
				selectors: [
					{ kind: "lineRange", startLine: f.startLine, endLine: f.endLine ?? f.startLine },
				],
			},
		});
	}
	return addComment({
		workspaceId: params.workspaceId,
		kind: "review",
		author: "agent",
		body: f.body,
		origin,
		anchor: null,
	});
}

/** File a whole finding set as one all-or-nothing operation: if any `fileFinding()` write throws
 * partway, the drafts already persisted in this call are deleted before the error propagates, so a
 * partial failure never strands open findings whose canonical ids the caller never received. All filed
 * comments are still drafts here, so `deleteComment` always applies. See planReview.SPEC.md. */
async function fileFindings(
	params: ReviewParams,
	reviewedSha: string,
	raw: ReviewFixComment[],
): Promise<ReviewFixComment[]> {
	const findings: ReviewFixComment[] = [];
	try {
		for (const f of raw) {
			const persisted = await fileFinding(params, reviewedSha, f);
			findings.push({ ...f, id: persisted.id });
		}
	} catch (err) {
		for (const f of findings) await deleteComment(params.workspaceId, f.id).catch(() => {});
		throw err;
	}
	return findings;
}

/** Undo just-filed findings while the review lock is held: roll back any `sent` assignment first, then
 * delete the drafts. Compensates a review-record write that throws AFTER filing so a cancelled review
 * never leaves open findings whose canonical ids the worker never received. Best-effort per comment. */
async function unfileFindings(
	params: ReviewParams,
	filed: ReviewFixComment[],
	sent: boolean,
): Promise<void> {
	if (sent) {
		rollbackSend(
			params.workspaceId,
			filed.map((f) => f.id),
			params.sessionId,
		);
	}
	for (const f of filed) await deleteComment(params.workspaceId, f.id).catch(() => {});
}

/** Own the whole button-path critical section: file the reviewer's findings, record cycle 1, select
 * them, and mark them `sent` — all in ONE `withReviewLock` hold — then deliver the structured
 * `todo-review-fix` message to the worker chat. Filing and reservation share the lock so no interleaved
 * Review send can mark the just-filed drafts `sent` in a gap and leave the worker a generic request with
 * no canonical ids (which would strand a later approve). Failure semantics split on whether filing
 * completed: a *filing* failure throws (nothing recorded yet, so the caller cancels the review — and
 * `fileFindings` already compensated its partial persist); any *post-filing* failure records cycle 2 to
 * give the auto cycle back, rolls any marked findings to draft, and returns the terminal outcome. The
 * caller must not have recorded the cycle before calling this. See host/SPEC.md and planReview.SPEC.md. */
async function deliverFixToWorker(
	params: ReviewParams,
	note: string,
	reviewedSha: string,
	raw: ReviewFixComment[],
	record: (autoCycles: number) => { item: Todo },
): Promise<VerdictOutcome> {
	let marked: string[] = [];
	let filed: ReviewFixComment[] = [];
	let recorded = false;
	try {
		const prepared = await withReviewLock(params.workspaceId, async () => {
			const snapshot = await getReviewSnapshot(params.workspaceId);
			filed = await fileFindings(params, reviewedSha, raw);
			let item: Todo;
			try {
				item = record(1).item;
			} catch (err) {
				await unfileFindings(params, filed, false);
				throw err;
			}
			recorded = true;
			const findings: ReviewComment[] = await itemFixFindings(params);
			const sentIds = findings.map((c) => c.id);
			const fixPackage =
				findings.length > 0 ? await buildSendPackage(params.workspaceId, findings) : null;
			if (sentIds.length > 0) {
				await markCommentsSent(params.workspaceId, sentIds, params.sessionId);
				marked = sentIds;
			}
			return {
				text: fixPackage
					? `${renderFixPackage(item, note)}\n\n${fixPackage}`
					: renderFixPackage(item, note),
				details: buildReviewFixDetails({
					itemId: item.id,
					itemTitle: item.title,
					reviewId: snapshot.review.id,
					note,
					comments: findings,
				}),
			};
		});
		await ackSend(sendReviewFixToSession(params.sessionId, prepared.text, prepared.details));
		return { kind: "changes", canAutoFix: true, findings: filed };
	} catch (err) {
		if (!recorded) throw err;
		if (marked.length > 0) rollbackSend(params.workspaceId, marked, params.sessionId);
		notifyExtUi(
			params.sessionId,
			`Fix send failed: ${err instanceof Error ? err.message : String(err)} — the findings stay in Review for you.`,
			"error",
		);
		record(2);
		return { kind: "changes", canAutoFix: false, findings: filed };
	} finally {
		releaseItemFix(params.sessionId, params.id);
	}
}

async function recordVerdict(
	params: ReviewParams,
	result: PlanReviewResult,
	reviewedSha: string,
	deliverFix: boolean,
): Promise<VerdictOutcome> {
	const capture = additionalCapture();
	const decided = (verdict: "approved" | "changes_requested") =>
		captureAdditional(capture, { name: "review_decided", params: { actor: "agent", verdict } });
	if (result.verdict === "approve") {
		const open = await itemOpenFindings(params);
		if (open.length === 0) {
			approveTodoReview(params, "agent");
			decided("approved");
			return { kind: "approved" };
		}
		cancelTodoReview(params);
		if (deliverFix)
			notifyExtUi(
				params.sessionId,
				`The reviewer approved "${result.itemTitle}", but ${open.length} finding(s) on it are still open in Review — the step stays unreviewed until they are resolved.`,
				"warning",
			);
		return { kind: "approve-blocked", openFindings: open.length };
	}
	decided("changes_requested");
	const spent = todoReviewAutoCycles(params) ?? 0;
	const canAutoFix = getConfig().reviewAutoFix !== false && spent < 1;
	const note = result.summary || DEFAULT_FIX_NOTE;
	const record = (autoCycles: number) =>
		recordAgentChangesRequested({
			...params,
			...(result.summary ? { note: result.summary } : {}),
			autoCycles,
		});
	if (!canAutoFix) {
		// Auto-fix off / cycle spent: file + record under the lock so a concurrent send can't mark one
		// draft `sent` between two writes (defeating fileFindings' compensation), and a record-write failure
		// deletes the just-filed drafts rather than stranding them past the cancel. See planReview.SPEC.md.
		const findings = await withReviewLock(params.workspaceId, async () => {
			const filed = await fileFindings(params, reviewedSha, result.findings);
			try {
				record(2);
			} catch (err) {
				await unfileFindings(params, filed, false);
				throw err;
			}
			return filed;
		});
		return { kind: "changes", canAutoFix: false, findings };
	}
	if (!deliverFix) {
		// Tool path: file the findings, mark them sent to the worker, and record the cycle as one locked
		// transaction, so a concurrent clear or a non-draft collision can't strand open findings whose
		// canonical ids the worker never received. `fileFindings` compensates a mid-loop persist failure;
		// a mark failure deletes the just-filed drafts; a record failure rolls the sent findings back and
		// deletes them so the cancel leaves nothing open. See planReview.SPEC.md.
		const findings = await withReviewLock(params.workspaceId, async () => {
			const filed = await fileFindings(params, reviewedSha, result.findings);
			try {
				await markCommentsSent(
					params.workspaceId,
					filed.map((f) => f.id),
					params.sessionId,
				);
			} catch (err) {
				await unfileFindings(params, filed, false);
				throw err;
			}
			try {
				record(1);
			} catch (err) {
				await unfileFindings(params, filed, true);
				throw err;
			}
			return filed;
		});
		return { kind: "changes", canAutoFix: true, findings };
	}
	// Button path: when we win the fix claim, deliverFixToWorker files + records + marks-sent + sends as
	// one transaction (see its doc) so an interleaved Review send can't strand the findings; it records
	// the cycle itself. If we lost the claim (another fix is in flight) we only file the findings for the
	// user, under the lock, and record the terminal cycle here. See planReview.SPEC.md.
	if (claimItemFix(params.sessionId, params.id))
		return deliverFixToWorker(params, note, reviewedSha, result.findings, record);
	const findings = await withReviewLock(params.workspaceId, async () => {
		const filed = await fileFindings(params, reviewedSha, result.findings);
		try {
			record(2);
		} catch (err) {
			await unfileFindings(params, filed, false);
			throw err;
		}
		return filed;
	});
	return { kind: "changes", canAutoFix: false, findings };
}

export type ReviewRunner = typeof runReviewSubagent;

async function runReview(
	params: ReviewParams,
	pkg: string,
	reviewedSha: string,
	itemTitle: string,
	signal: AbortSignal | undefined,
	runSubagent: ReviewRunner,
): Promise<PlanReviewResult> {
	const cfg = getConfig();
	// Pinned reviewer model + effort, else the user's default for each — never the worker's silently
	// inherited model or effort. `thinkingLevel` is passed unconditionally so pi-delegation cannot fall
	// back to the parent worker's effort when reviewEffort is unset. See planReview.SPEC.md.
	const def = await getDefaultModel();
	const model = cfg.reviewModel ?? def.model;
	const thinkingLevel = cfg.reviewEffort ?? def.thinkingLevel;
	const run = await runSubagent(
		params.workspaceId,
		params.sessionId,
		`${pkg}\n\n${REVIEWER_OUTPUT_CONTRACT}`,
		{
			systemPrompt: REVIEWER_SYSTEM_PROMPT,
			tools: REVIEWER_TOOLS,
			...(model ? { model: { provider: model.provider, id: model.id } } : {}),
			thinkingLevel,
		},
		signal,
	);
	if (run.status !== "completed") {
		throw new Error(`The review subagent did not complete (${run.status}).`);
	}
	const parsed = parseVerdict(run.finalText, params.id, itemTitle);
	if (!parsed) throw new Error("The review subagent did not return a valid verdict.");
	return { ...parsed, ...(reviewedSha ? { reviewedSha } : {}) };
}

async function handleRequestReview(
	sessionId: string,
	itemId: string,
	signal: AbortSignal | undefined,
	runSubagent: ReviewRunner,
): Promise<{ result: PlanReviewResult; text: string }> {
	const workspaceId = getSessionWorkspaceId(sessionId);
	if (!workspaceId) throw new Error("This chat is not attached to a workspace.");
	if (!claimItemReview(sessionId, itemId)) throw new Error("This step is already being reviewed.");
	const params = { workspaceId, sessionId, id: itemId };
	try {
		// Await the reconciliation barrier so the snapshot sees the just-committed change set. See planReview.SPEC.md.
		await settleChangeArtifacts(workspaceId);
		const { pkg, reviewedSha } = startTodoReview(params);
		return await onPlanChain(workspaceId, sessionId, async () => {
			const itemTitle = await itemTitleOf(workspaceId, sessionId, itemId);
			const result = await runReview(params, pkg, reviewedSha, itemTitle, signal, runSubagent);
			const outcome = await recordVerdict(params, result, reviewedSha, false);
			const blocked =
				outcome.kind === "approve-blocked" ? { blockedByOpenFindings: outcome.openFindings } : {};
			const findings =
				outcome.kind === "changes" ? (outcome.findings ?? result.findings) : result.findings;
			return { result: { ...result, findings, ...blocked }, text: composeText(result, outcome) };
		});
	} catch (err) {
		cancelTodoReview(params);
		throw err;
	} finally {
		releaseItemReview(sessionId, itemId);
		await publishReview(workspaceId).catch(() => {});
	}
}

/** Button-triggered plan review; returns immediately. The `reviewing` mark MUST stay synchronous —
 * see planReview.SPEC.md. */
export function startPlanReview(
	workspaceId: string,
	sessionId: string,
	itemId: string,
	runSubagent: ReviewRunner = runReviewSubagent,
): boolean {
	if (itemReviewActive(sessionId, itemId)) return false;
	const params = { workspaceId, sessionId, id: itemId };
	const { pkg, reviewedSha } = startTodoReview(params);
	return enqueuePlanReview(workspaceId, sessionId, itemId, async () => {
		let itemTitle = itemId;
		try {
			itemTitle = await itemTitleOf(workspaceId, sessionId, itemId);
			const result = await runReview(params, pkg, reviewedSha, itemTitle, undefined, runSubagent);
			await recordVerdict(params, result, reviewedSha, true);
		} catch (err) {
			cancelTodoReview(params);
			// The detached path has no chat to carry the error; publish it so the plan page can toast. See planReview.SPEC.md.
			reviewFailedPublisher({
				workspaceId,
				sessionId,
				itemId,
				itemTitle,
				message: err instanceof Error ? err.message : String(err),
			});
			throw err;
		} finally {
			await publishReview(workspaceId).catch(() => {});
		}
	});
}

/** After a fix lands (the worker re-marks the step done), re-review exactly the items still inside their
 * one auto cycle — see host/SPEC.md ("auto re-review") for why `unreviewed` counts as a fresh delta.
 * Eligible items are enqueued onto the plan's serial chain even while another review runs; the per-item
 * claim dedupes, so a fix landing mid-review is not dropped. */
export async function maybeAutoReReview(
	workspaceId: string,
	sessionId: string,
	runSubagent: ReviewRunner = runReviewSubagent,
): Promise<void> {
	try {
		const plan = await listTodos({ workspaceId, sessionId });
		const items = [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
		for (const item of items) {
			const r = item.review;
			if (r?.reviewing || item.status !== "done") continue;
			if (todoReviewAutoCycles({ workspaceId, sessionId, id: item.id }) !== 1) continue;
			const freshCommitDelta =
				r?.state === "changes_requested" && (r.unreviewedShas?.length ?? 0) > 0;
			if (!freshCommitDelta && r?.state !== "unreviewed") continue;
			startPlanReview(workspaceId, sessionId, item.id, runSubagent);
		}
	} catch (err) {
		console.warn(`auto re-review skipped (${workspaceId}/${sessionId}): ${err}`);
	}
}

export function installRequestReviewSeam(runSubagent: ReviewRunner = runReviewSubagent): void {
	setRequestReviewHandler((sessionId, itemId, signal) =>
		handleRequestReview(sessionId, itemId, signal, runSubagent),
	);
}
