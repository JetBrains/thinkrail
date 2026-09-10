import type { PlanReviewResult, ReviewFixComment } from "@thinkrail/contracts";
import { isPlanReviewResult } from "@thinkrail/contracts";
import { getSessionWorkspaceId, runReviewSubagent, setRequestReviewHandler } from "../agent";
import { addComment, anchorProblem, publishReview } from "../reviews";
import { getConfig } from "../settings";
import {
	approveTodoReview,
	cancelTodoReview,
	listTodos,
	recordAgentChangesRequested,
	startTodoReview,
} from "../todos";

const REVIEWER_TOOLS = ["read", "grep", "find", "ls", "bash"];

const REVIEWER_SYSTEM_PROMPT = [
	"You are an independent, read-only code reviewer for ONE completed plan step.",
	"You never edit files. Inspect the step's change set (the commits/paths named in the task) with your",
	"tools — read the actual files, run git as needed — and judge whether the change correctly and safely",
	"does what the step claims, with no regressions, dead code, or unhandled cases.",
	"",
	"Be material: report only real problems (correctness, safety, missing cases, contract/spec violations),",
	"not style nits. If the change is sound, approve.",
	"",
	"End your turn with EXACTLY ONE fenced json block and nothing after it:",
	"```json",
	'{ "verdict": "approve" | "request_changes",',
	'  "summary": "one short paragraph on the overall judgement",',
	'  "findings": [ { "id": "f1", "path": "src/x.ts", "startLine": 12, "endLine": 14, "body": "what is wrong and what to do" } ] }',
	"```",
	"Use verdict `approve` only when there are no blocking findings (findings may then be empty).",
	"Every finding needs a stable `id` and a `body`; `path`/`startLine`/`endLine` are optional but include",
	"them when the problem is at a location.",
].join("\n");

const OUTPUT_CONTRACT =
	"Review the change set above. Reply with your verdict as the single fenced json block described in your instructions.";

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

export function composeText(result: PlanReviewResult, autoFix: boolean): string {
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
	const next = autoFix
		? "Address each finding below (re-open the step, fix it, mark it done with a fresh commit), then request_review again."
		: "Auto-fix is off: do NOT fix now. Report these findings to the user and wait for their direction.";
	return `${head} ${next}${rationale}${findings}`;
}

type ReviewParams = { workspaceId: string; sessionId: string; id: string };

/** File a reviewer finding into the Review tab (an inline comment when it anchors, else review-level) so
 * the button-triggered path shows findings without a chat card. Best-effort: a bad anchor never fails the review. */
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

async function runAndRecordVerdict(
	params: ReviewParams,
	pkg: string,
	reviewedSha: string,
	itemTitle: string,
	signal: AbortSignal | undefined,
): Promise<PlanReviewResult> {
	const cfg = getConfig();
	const run = await runReviewSubagent(
		params.workspaceId,
		params.sessionId,
		`${pkg}\n\n${OUTPUT_CONTRACT}`,
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
	if (parsed.verdict === "approve") {
		approveTodoReview(params, "agent");
	} else {
		for (const f of parsed.findings) await fileFinding(params, reviewedSha, f);
		recordAgentChangesRequested({
			...params,
			...(parsed.summary ? { note: parsed.summary } : {}),
			autoCycles: 1,
		});
	}
	return { ...parsed, ...(reviewedSha ? { reviewedSha } : {}) };
}

/** Run a plan-step review to completion (host-triggered, e.g. the Start review button): spawn the review
 * subagent as a child of the plan session, record the verdict, and file findings into the Review tab. */
export async function runPlanReviewForItem(
	sessionId: string,
	itemId: string,
	signal?: AbortSignal,
): Promise<PlanReviewResult> {
	const workspaceId = getSessionWorkspaceId(sessionId);
	if (!workspaceId) throw new Error("This chat is not attached to a workspace.");
	const params = { workspaceId, sessionId, id: itemId };
	const { pkg, reviewedSha } = startTodoReview(params);
	const itemTitle = await itemTitleOf(workspaceId, sessionId, itemId);
	try {
		return await runAndRecordVerdict(params, pkg, reviewedSha, itemTitle, signal);
	} catch (err) {
		cancelTodoReview(params);
		throw err;
	}
}

async function handleRequestReview(
	sessionId: string,
	itemId: string,
	signal: AbortSignal | undefined,
): Promise<{ result: PlanReviewResult; text: string }> {
	const result = await runPlanReviewForItem(sessionId, itemId, signal);
	return { result, text: composeText(result, getConfig().reviewAutoFix !== false) };
}

/**
 * Button-triggered plan review (host-side): mark the item **reviewing synchronously** (so the panel shows
 * the pulse the instant the client re-reads the plan), then run the review subagent in the background and
 * push a review-changed refresh when the verdict lands. Returns immediately — the caller does not wait.
 */
export function startPlanReviewInBackground(
	workspaceId: string,
	sessionId: string,
	itemId: string,
): void {
	const params = { workspaceId, sessionId, id: itemId };
	const { pkg, reviewedSha } = startTodoReview(params);
	void (async () => {
		try {
			const itemTitle = await itemTitleOf(workspaceId, sessionId, itemId);
			await runAndRecordVerdict(params, pkg, reviewedSha, itemTitle, undefined);
		} catch (err) {
			cancelTodoReview(params);
			console.warn(`plan review failed (${itemId}): ${err instanceof Error ? err.message : err}`);
		} finally {
			await publishReview(workspaceId).catch(() => {});
		}
	})();
}

export function installRequestReviewSeam(): void {
	setRequestReviewHandler(handleRequestReview);
}
