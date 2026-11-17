import { PR_BABYSIT_MARKER, PR_REVIEW_MARKER, type PrCheckState } from "@thinkrail/contracts";
import { nonInteractiveGitEnv } from "../git";
import { runBounded } from "../subprocess";

export interface GhResult {
	ok: boolean;
	out: string;
	err: string;
}

export type GhRunner = (
	cwd: string,
	args: string[],
	options?: { stdin?: string; timeoutMs?: number },
) => Promise<GhResult>;

const GH_TIMEOUT_MS = 30_000;

export const runGh: GhRunner = async (cwd, args, options = {}) => {
	const run = await runBounded(["gh", ...args], {
		cwd,
		timeoutMs: options.timeoutMs ?? GH_TIMEOUT_MS,
		env: { ...nonInteractiveGitEnv(), GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
		...(options.stdin === undefined ? {} : { stdin: new Blob([options.stdin]) }),
	});
	return { ok: run.ok, out: run.out.trim(), err: run.err.trim() };
};

export interface PrRef {
	owner: string;
	repo: string;
	number: number;
}

export interface PrThreadComment {
	id: string;
	databaseId: number;
	author: string;
	body: string;
	createdAt: string;
	url?: string;
}

export interface PrReviewThread {
	id: string;
	isResolved: boolean;
	isOutdated: boolean;
	path?: string;
	line?: number;
	originalLine?: number;
	comments: PrThreadComment[];
}

export interface PrCheckRun {
	name: string;
	/** Lower-cased `CheckRun.conclusion` / `StatusContext.state`; `null` while it runs. */
	conclusion: string | null;
	detailsUrl?: string;
	/** GitHub Actions run id behind the check, when there is one. */
	runId?: number;
}

export type PrLifecycleState = "OPEN" | "MERGED" | "CLOSED";

export interface PrSnapshot {
	number: number;
	url?: string;
	state: PrLifecycleState;
	baseRefName: string;
	headRefName: string;
	headRefOid: string;
	reviewDecision: string | null;
	threads: PrReviewThread[];
	checks: PrCheckState | null;
	checkRuns: PrCheckRun[];
}

export const PR_STATE_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number url state baseRefName headRefName headRefOid reviewDecision
      reviewThreads(first: 50) {
        nodes {
          id isResolved isOutdated path line originalLine
          comments(first: 20) { nodes { id databaseId author { login } body createdAt url } }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              state
              contexts(first: 50) {
                nodes {
                  __typename
                  ... on CheckRun { name conclusion status detailsUrl checkSuite { workflowRun { databaseId } } }
                  ... on StatusContext { context state targetUrl }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function nodes(value: unknown): Json[] {
	const list = obj(value)?.nodes;
	return Array.isArray(list) ? list.map(obj).filter((node): node is Json => node !== null) : [];
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function int(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function rollupState(value: unknown): PrCheckState | null {
	switch (value) {
		case "SUCCESS":
			return "success";
		case "FAILURE":
		case "ERROR":
			return "failure";
		case "PENDING":
		case "EXPECTED":
			return "pending";
		default:
			return null;
	}
}

/** `gh api graphql` output for {@link PR_STATE_QUERY} → a snapshot; `null` when it is not a pull request. */
export function parsePrSnapshot(raw: unknown): PrSnapshot | null {
	const pr = obj(obj(obj(obj(raw)?.data)?.repository)?.pullRequest);
	if (!pr) return null;
	const number = int(pr.number);
	const state = str(pr.state);
	const headRefOid = str(pr.headRefOid);
	if (number === undefined || !headRefOid) return null;
	if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") return null;
	const threads: PrReviewThread[] = nodes(pr.reviewThreads).flatMap((thread) => {
		const id = str(thread.id);
		if (!id) return [];
		const comments: PrThreadComment[] = nodes(thread.comments).flatMap((comment) => {
			const commentId = str(comment.id);
			const databaseId = int(comment.databaseId);
			if (!commentId || databaseId === undefined) return [];
			const url = str(comment.url);
			return [
				{
					id: commentId,
					databaseId,
					author: str(obj(comment.author)?.login) ?? "ghost",
					body: str(comment.body) ?? "",
					createdAt: str(comment.createdAt) ?? "",
					...(url ? { url } : {}),
				},
			];
		});
		const path = str(thread.path);
		const line = int(thread.line);
		const originalLine = int(thread.originalLine);
		return [
			{
				id,
				isResolved: thread.isResolved === true,
				isOutdated: thread.isOutdated === true,
				...(path ? { path } : {}),
				...(line !== undefined ? { line } : {}),
				...(originalLine !== undefined ? { originalLine } : {}),
				comments,
			},
		];
	});
	const rollup = obj(obj(nodes(pr.commits)[0]?.commit)?.statusCheckRollup);
	const checkRuns: PrCheckRun[] = nodes(rollup?.contexts).flatMap((context) => {
		if (context.__typename === "CheckRun") {
			const name = str(context.name);
			if (!name) return [];
			const conclusion = str(context.conclusion)?.toLowerCase() ?? null;
			const detailsUrl = str(context.detailsUrl);
			const runId = int(obj(obj(context.checkSuite)?.workflowRun)?.databaseId);
			return [
				{
					name,
					conclusion,
					...(detailsUrl ? { detailsUrl } : {}),
					...(runId !== undefined ? { runId } : {}),
				},
			];
		}
		if (context.__typename === "StatusContext") {
			const name = str(context.context);
			if (!name) return [];
			const state = str(context.state)?.toLowerCase();
			const detailsUrl = str(context.targetUrl);
			return [
				{
					name,
					conclusion: state === "pending" || state === "expected" ? null : (state ?? null),
					...(detailsUrl ? { detailsUrl } : {}),
				},
			];
		}
		return [];
	});
	const url = str(pr.url);
	return {
		number,
		...(url ? { url } : {}),
		state,
		baseRefName: str(pr.baseRefName) ?? "",
		headRefName: str(pr.headRefName) ?? "",
		headRefOid,
		reviewDecision: str(pr.reviewDecision) ?? null,
		threads,
		checks: rollupState(rollup?.state),
		checkRuns,
	};
}

const FAILED_CONCLUSIONS = new Set([
	"failure",
	"error",
	"timed_out",
	"action_required",
	"startup_failure",
]);

export function isFailedCheck(check: PrCheckRun): boolean {
	return check.conclusion !== null && FAILED_CONCLUSIONS.has(check.conclusion);
}

/** The self-loop and bot guard: never act on our own login or anything either agent posted. */
export function isIgnoredComment(
	comment: Pick<PrThreadComment, "author" | "body">,
	viewerLogin: string | undefined,
): boolean {
	if (viewerLogin && comment.author.toLowerCase() === viewerLogin.toLowerCase()) return true;
	return comment.body.includes(PR_BABYSIT_MARKER) || comment.body.includes(PR_REVIEW_MARKER);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

export class GhError extends Error {
	readonly step: string;

	constructor(step: string, detail: string) {
		super(`gh ${step} failed${detail ? `: ${detail.slice(0, 300)}` : ""}`);
		this.name = "GhError";
		this.step = step;
	}
}

async function must(run: GhRunner, cwd: string, step: string, args: string[], stdin?: string) {
	const result = await run(cwd, args, stdin === undefined ? {} : { stdin });
	if (!result.ok) throw new GhError(step, result.err);
	return result.out;
}

export async function fetchPrSnapshot(run: GhRunner, cwd: string, pr: PrRef): Promise<PrSnapshot> {
	const out = await must(run, cwd, "pr state", [
		"api",
		"graphql",
		"-f",
		`query=${PR_STATE_QUERY}`,
		"-f",
		`owner=${pr.owner}`,
		"-f",
		`repo=${pr.repo}`,
		"-F",
		`number=${pr.number}`,
	]);
	const snapshot = parsePrSnapshot(parseJson(out));
	if (!snapshot) throw new GhError("pr state", "the response was not a pull request");
	return snapshot;
}

export async function fetchViewerLogin(run: GhRunner, cwd: string): Promise<string | undefined> {
	const result = await run(cwd, ["api", "user", "--jq", ".login"]);
	const login = result.ok ? result.out.trim() : "";
	return login || undefined;
}

export async function replyToReviewComment(
	run: GhRunner,
	cwd: string,
	pr: PrRef,
	commentDatabaseId: number,
	body: string,
): Promise<void> {
	await must(run, cwd, "reply", [
		"api",
		`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments/${commentDatabaseId}/replies`,
		"-f",
		`body=${body}`,
	]);
}

export async function resolveReviewThread(
	run: GhRunner,
	cwd: string,
	threadId: string,
): Promise<void> {
	await must(run, cwd, "resolve thread", [
		"api",
		"graphql",
		"-f",
		"query=mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }",
		"-f",
		`threadId=${threadId}`,
	]);
}

export interface PrReviewComment {
	path: string;
	line: number;
	body: string;
}

export async function postPrReview(
	run: GhRunner,
	cwd: string,
	pr: PrRef,
	review: {
		event: "COMMENT" | "REQUEST_CHANGES";
		body: string;
		commitId: string;
		comments: PrReviewComment[];
	},
): Promise<void> {
	const payload = JSON.stringify({
		event: review.event,
		body: review.body,
		commit_id: review.commitId,
		comments: review.comments.map((comment) => ({
			path: comment.path,
			line: comment.line,
			side: "RIGHT",
			body: comment.body,
		})),
	});
	await must(
		run,
		cwd,
		"post review",
		[
			"api",
			"-X",
			"POST",
			`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`,
			"--input",
			"-",
		],
		payload,
	);
}

const LOG_TAIL_LINES = 150;
const LOG_TAIL_CHARS = 12_000;

/** The tail of a failing run's log, where the error is; bounded in lines and characters. */
export function tailLog(
	text: string,
	maxLines = LOG_TAIL_LINES,
	maxChars = LOG_TAIL_CHARS,
): string {
	const lines = text.replace(/\r\n/g, "\n").trimEnd().split("\n");
	const tail = lines.slice(-maxLines).join("\n");
	return tail.length <= maxChars ? tail : tail.slice(tail.length - maxChars);
}

export async function fetchFailedRunLog(
	run: GhRunner,
	cwd: string,
	pr: Pick<PrRef, "owner" | "repo">,
	runId: number,
): Promise<string | null> {
	const result = await run(
		cwd,
		["run", "view", String(runId), "--log-failed", "--repo", `${pr.owner}/${pr.repo}`],
		{ timeoutMs: 60_000 },
	);
	return result.ok && result.out ? tailLog(result.out) : null;
}
