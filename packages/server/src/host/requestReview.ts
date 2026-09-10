import type { PlanReviewResult, ReviewComment, ReviewFixComment } from "@thinkrail/contracts";
import { isPlanReviewResult } from "@thinkrail/contracts";
import type { Todo } from "pi-todos/core";
import {
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
	startTodoReview,
	todoReviewAutoCycles,
} from "../todos";
import { ackSend } from "./ackSend";
import {
	claimItemReview,
	enqueuePlanReview,
	itemReviewActive,
	planReviewRunning,
	releaseItemReview,
} from "./planReviewQueue";
import { REVIEWER_OUTPUT_CONTRACT, REVIEWER_SYSTEM_PROMPT, REVIEWER_TOOLS } from "./reviewerRole";
import { withReviewLock } from "./reviewLock";
import { claimItemFix, itemFixFindings, releaseItemFix } from "./todoReview";

const DEFAULT_FIX_NOTE = "Address the reviewer's findings below.";

type ReviewParams = { workspaceId: string; sessionId: string; id: string };

function itemTitleOf(workspaceId: string, sessionId: string, itemId: string): Promise<string> {
	return listTodos({ workspaceId, sessionId }).then((plan) => {
		const all = [...plan.todos, ...plan.groups.flatMap((g) => g.todos)];
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
	return { ...candidate, findings };
}

export function composeText(result: PlanReviewResult, canAutoFix: boolean): string {
	const findings =
		result.findings.length > 0
			? `\n\n${result.findings
					.map((f) => {
						const loc = f.path
							? ` (${f.path}${f.startLine ? `:${f.startLine}${f.endLine && f.endLine !== f.startLine ? `-${f.endLine}` : ""}` : ""})`
							: "";
						return `- [${f.id}]${loc} ${f.body}`;
					})
					.join("\n")}`
			: "";
	const rationale = result.summary ? `\n\n${result.summary}` : "";
	if (result.verdict === "approve") {
		return `Review verdict: APPROVE — step "${result.itemTitle}".${rationale}${findings}`;
	}
	const head = `Review verdict: REQUEST_CHANGES — step "${result.itemTitle}".`;
	const next = canAutoFix
		? "Address each finding below (re-open the step, fix it, mark it done with a fresh commit), then request_review again."
		: "The automated fix cycle is spent or auto-fix is off: do NOT fix now. Report these findings to the user and wait for their direction.";
	return `${head} ${next}${rationale}${findings}`;
}

/** File a reviewer finding into the Review tab (an inline comment when it anchors, else review-level).
 * Best-effort: a bad anchor never fails the review. */
async function fileFinding(
	params: ReviewParams,
	reviewedSha: string,
	f: ReviewFixComment,
): Promise<void> {
	const origin = { todoId: params.id, reviewedSha, sessionId: params.sessionId };
	try {
		if (f.path && f.startLine && !anchorProblem(params.workspaceId, f.path, f.startLine)) {
			await addComment({
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
			return;
		}
		await addComment({
			workspaceId: params.workspaceId,
			kind: "review",
			author: "agent",
			body: f.body,
			origin,
			anchor: null,
		});
	} catch (err) {
		console.warn(`review finding not filed: ${err instanceof Error ? err.message : err}`);
	}
}

/** Deliver the reviewer's findings to the worker chat as the structured `todo-review-fix` message, under
 * the same mark-sent / pre-turn-rollback guarantee every review send has — see host/SPEC.md. */
async function deliverFixToWorker(params: ReviewParams, item: Todo, note: string): Promise<void> {
	try {
		const prepared = await withReviewLock(params.workspaceId, async () => {
			const snapshot = await getReviewSnapshot(params.workspaceId);
			const findings: ReviewComment[] = await itemFixFindings(params);
			const sentIds = findings.map((c) => c.id);
			const fixPackage =
				findings.length > 0 ? await buildSendPackage(params.workspaceId, findings) : null;
			if (sentIds.length > 0) await markCommentsSent(params.workspaceId, sentIds, params.sessionId);
			return {
				sentIds,
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
		await ackSend(sendReviewFixToSession(params.sessionId, prepared.text, prepared.details)).catch(
			(err: unknown) => {
				if (prepared.sentIds.length > 0)
					rollbackSend(params.workspaceId, prepared.sentIds, params.sessionId);
				notifyExtUi(
					params.sessionId,
					`Fix send failed: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			},
		);
	} finally {
		releaseItemFix(params.sessionId, params.id);
	}
}

async function recordVerdict(
	params: ReviewParams,
	result: PlanReviewResult,
	reviewedSha: string,
	deliverFix: boolean,
): Promise<{ canAutoFix: boolean }> {
	if (result.verdict === "approve") {
		approveTodoReview(params, "agent");
		return { canAutoFix: false };
	}
	for (const f of result.findings) await fileFinding(params, reviewedSha, f);
	const spent = todoReviewAutoCycles(params) ?? 0;
	const canAutoFix = getConfig().reviewAutoFix !== false && spent < 1;
	const claimed = canAutoFix && deliverFix && claimItemFix(params.sessionId, params.id);
	const { item } = recordAgentChangesRequested({
		...params,
		...(result.summary ? { note: result.summary } : {}),
		autoCycles: canAutoFix ? 1 : 2,
	});
	if (claimed) await deliverFixToWorker(params, item, result.summary || DEFAULT_FIX_NOTE);
	return { canAutoFix };
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
	const run = await runSubagent(
		params.workspaceId,
		params.sessionId,
		`${pkg}\n\n${REVIEWER_OUTPUT_CONTRACT}`,
		{
			systemPrompt: REVIEWER_SYSTEM_PROMPT,
			tools: REVIEWER_TOOLS,
			...(cfg.reviewModel
				? { model: { provider: cfg.reviewModel.provider, id: cfg.reviewModel.id } }
				: {}),
			...(cfg.reviewEffort ? { thinkingLevel: cfg.reviewEffort } : {}),
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
): Promise<{ result: PlanReviewResult; text: string }> {
	const workspaceId = getSessionWorkspaceId(sessionId);
	if (!workspaceId) throw new Error("This chat is not attached to a workspace.");
	if (!claimItemReview(sessionId, itemId)) throw new Error("This step is already being reviewed.");
	const params = { workspaceId, sessionId, id: itemId };
	const { pkg, reviewedSha } = startTodoReview(params);
	try {
		const itemTitle = await itemTitleOf(workspaceId, sessionId, itemId);
		const result = await runReview(params, pkg, reviewedSha, itemTitle, signal, runReviewSubagent);
		const { canAutoFix } = await recordVerdict(params, result, reviewedSha, false);
		return { result, text: composeText(result, canAutoFix) };
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
		try {
			const itemTitle = await itemTitleOf(workspaceId, sessionId, itemId);
			const result = await runReview(params, pkg, reviewedSha, itemTitle, undefined, runSubagent);
			await recordVerdict(params, result, reviewedSha, true);
		} catch (err) {
			cancelTodoReview(params);
			throw err;
		} finally {
			await publishReview(workspaceId).catch(() => {});
		}
	});
}

/** After a fix lands (the worker re-marks the step done), re-review exactly the items still inside their
 * one auto cycle — see host/SPEC.md ("auto re-review") for why `unreviewed` counts as a fresh delta. */
export async function maybeAutoReReview(workspaceId: string, sessionId: string): Promise<void> {
	if (planReviewRunning(workspaceId, sessionId)) return;
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
			startPlanReview(workspaceId, sessionId, item.id);
		}
	} catch (err) {
		console.warn(`auto re-review skipped (${workspaceId}/${sessionId}): ${err}`);
	}
}

export function installRequestReviewSeam(): void {
	setRequestReviewHandler(handleRequestReview);
}
