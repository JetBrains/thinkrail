import { dirname } from "node:path/posix";
import {
	isReviewFindingSeverity,
	PR_REVIEW_MARKER,
	type PrBabysitItem,
} from "@thinkrail/contracts";
import type { PrReviewComment } from "./github";
import type { ReviewFinding } from "./store";

/** No write, edit or shell tool: the independent reviewer cannot change the worktree. */
export const READ_ONLY_REVIEWER_TOOLS = [
	"read",
	"grep",
	"find",
	"ls",
	"spec_search",
	"spec_grep",
	"spec_get",
	"spec_graph",
];

export const PR_REVIEWER_SYSTEM_PROMPT = [
	"You are an independent, read-only reviewer of ONE GitHub pull request. You never edit files and you",
	"have no shell. You did not write this code and owe its author nothing: judge the diff against the",
	"codebase and the SPEC.md contracts that govern the changed paths.",
	"",
	"Look, in order, for: behavior that contradicts a SPEC.md invariant or public surface (spec drift);",
	"bugs at the edges (empty/absent values, error paths, concurrency, cleanup on every exit path);",
	"missing pieces (state that is set but never cleared, readers that mishandle stale state); calls to",
	"APIs that do not exist or have another signature; weakened or deleted tests.",
	"",
	"Read the real files with your tools before filing anything. Every finding names a concrete failure",
	"scenario; drop any you cannot confirm. Style is not your job.",
	"",
	"Severity: `blocker` (wrong behavior, data loss, security, a broken contract), `warning` (a real risk",
	"or a likely bug on an uncommon path), `suggestion` (worthwhile but optional).",
].join("\n");

export const PR_REVIEW_OUTPUT_CONTRACT = [
	"End your turn with EXACTLY ONE fenced json block and nothing after it: an array of findings,",
	"`[]` when there are none.",
	"```json",
	'[{ "path": "src/x.ts", "line": 42, "severity": "blocker" | "warning" | "suggestion",',
	'   "summary": "1–2 sentences: the problem and its failure scenario",',
	'   "suggested_fix": "what to change instead" }]',
	"```",
].join("\n");

const DIFF_BUDGET = 60_000;
const SPEC_BUDGET = 30_000;

function clipBlock(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated)`;
}

export interface SpecDocument {
	path: string;
	text: string;
}

export function buildReviewTask(input: {
	owner: string;
	repo: string;
	prNumber: number;
	baseRefName: string;
	headOid: string;
	changedPaths: readonly string[];
	diff: string;
	specs: readonly SpecDocument[];
}): string {
	let specBudget = SPEC_BUDGET;
	const specs = input.specs.flatMap((spec) => {
		if (specBudget <= 0) return [];
		const text = clipBlock(spec.text, specBudget);
		specBudget -= text.length;
		return [`### ${spec.path}\n\n${text}`];
	});
	return [
		`Review pull request ${input.owner}/${input.repo}#${input.prNumber} at ${input.headOid}`,
		`against its base \`${input.baseRefName}\`.`,
		"",
		`## Changed files (${input.changedPaths.length})`,
		...input.changedPaths.map((path) => `- ${path}`),
		"",
		"## Diff",
		"```diff",
		clipBlock(input.diff, DIFF_BUDGET),
		"```",
		...(specs.length > 0 ? ["", "## Governing SPEC.md contracts", "", ...specs] : []),
		"",
		PR_REVIEW_OUTPUT_CONTRACT,
	].join("\n");
}

/** Every SPEC.md from each changed path's directory up to the root, nearest first, deduped and capped. */
export function specPathsFor(
	changedPaths: readonly string[],
	exists: (path: string) => boolean,
	limit = 12,
): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	for (const changed of changedPaths) {
		if (changed.endsWith("SPEC.md") && !seen.has(changed)) {
			seen.add(changed);
			if (exists(changed)) found.push(changed);
		}
		let dir = dirname(changed);
		while (true) {
			const candidate = dir === "." ? "SPEC.md" : `${dir}/SPEC.md`;
			if (!seen.has(candidate)) {
				seen.add(candidate);
				if (exists(candidate)) found.push(candidate);
			}
			if (dir === "." || dir === "/" || dir === "") break;
			dir = dirname(dir);
		}
		if (found.length >= limit) break;
	}
	return found.slice(0, limit);
}

function lastJsonBlock(text: string): string | null {
	const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
	const fenced = fences.at(-1)?.[1];
	if (fenced) return fenced.trim();
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

function parseLoose(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * The reviewer's final text → findings. Tolerant of prose around the block, `{ "findings": [...] }`,
 * and `suggestedFix`; strict per entry (a severity and a summary are required). `null` = unparseable.
 */
export function parseReviewFindings(text: string): ReviewFinding[] | null {
	const block = lastJsonBlock(text);
	if (block === null) return null;
	const parsed = parseLoose(block);
	const list = Array.isArray(parsed)
		? parsed
		: parsed &&
				typeof parsed === "object" &&
				Array.isArray((parsed as { findings?: unknown }).findings)
			? (parsed as { findings: unknown[] }).findings
			: null;
	if (!list) return null;
	return list.flatMap((entry): ReviewFinding[] => {
		if (!entry || typeof entry !== "object") return [];
		const r = entry as Record<string, unknown>;
		const severity = typeof r.severity === "string" ? r.severity.toLowerCase() : r.severity;
		const summary = typeof r.summary === "string" ? r.summary.trim() : "";
		if (!isReviewFindingSeverity(severity) || !summary) return [];
		const path = typeof r.path === "string" && r.path.trim() ? r.path.trim() : undefined;
		const line =
			typeof r.line === "number" && Number.isInteger(r.line) && r.line > 0 ? r.line : undefined;
		const fixRaw = r.suggested_fix ?? r.suggestedFix;
		const suggestedFix = typeof fixRaw === "string" && fixRaw.trim() ? fixRaw.trim() : undefined;
		return [
			{
				severity,
				summary,
				...(path ? { path } : {}),
				...(line !== undefined ? { line } : {}),
				...(suggestedFix ? { suggestedFix } : {}),
			},
		];
	});
}

export const PATCH_CHECK_CONTRACT = [
	"You are checking ONE small fix another agent made for a pull-request review item, before it is",
	"pushed. Read the touched files. Reject only when the patch is clearly wrong: it does not address the",
	"item, breaks behavior, deletes or weakens tests, or touches unrelated code. End with EXACTLY ONE",
	"fenced json block and nothing after it:",
	"```json",
	'{ "verdict": "approve" | "reject", "reason": "one sentence" }',
	"```",
].join("\n");

export function buildPatchCheckTask(item: PrBabysitItem, diff: string): string {
	return [
		"## Review item",
		item.path ? `${item.path}${item.line ? `:${item.line}` : ""}` : "(no file)",
		item.summary,
		...(item.suggestedFix ? ["", `Suggested fix: ${item.suggestedFix}`] : []),
		"",
		"## The fix",
		"```diff",
		clipBlock(diff, DIFF_BUDGET),
		"```",
		"",
		PATCH_CHECK_CONTRACT,
	].join("\n");
}

export interface PatchVerdict {
	approved: boolean;
	reason: string;
}

/** An unparseable or absent verdict approves: the check is a sanity net, never a gate that wedges the queue. */
export function parsePatchVerdict(text: string | null): PatchVerdict {
	if (!text) return { approved: true, reason: "" };
	const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
	const block = fences.at(-1)?.[1] ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
	const parsed = parseLoose(block.trim());
	if (!parsed || typeof parsed !== "object") return { approved: true, reason: "" };
	const r = parsed as { verdict?: unknown; reason?: unknown };
	return {
		approved: r.verdict !== "reject",
		reason: typeof r.reason === "string" ? r.reason.trim() : "",
	};
}

const SEVERITY_LABEL: Record<ReviewFinding["severity"], string> = {
	blocker: "Blocker",
	warning: "Warning",
	suggestion: "Suggestion",
};

function findingBody(item: Pick<PrBabysitItem, "severity" | "summary" | "suggestedFix">): string {
	const head = item.severity ? `**${SEVERITY_LABEL[item.severity]}:** ` : "";
	const fix = item.suggestedFix ? `\n\n_Suggested fix:_ ${item.suggestedFix}` : "";
	return `${PR_REVIEW_MARKER} ${head}${item.summary}${fix}`;
}

/** A GitHub review from findings: anchored ones inline, the rest in the body; blockers request changes. */
export function renderGithubReview(items: readonly PrBabysitItem[]): {
	event: "COMMENT" | "REQUEST_CHANGES";
	body: string;
	comments: PrReviewComment[];
} {
	const comments: PrReviewComment[] = [];
	const loose: string[] = [];
	for (const item of items) {
		if (item.path && item.line)
			comments.push({ path: item.path, line: item.line, body: findingBody(item) });
		else loose.push(`- ${findingBody(item).replace(`${PR_REVIEW_MARKER} `, "")}`);
	}
	const blockers = items.filter((item) => item.severity === "blocker").length;
	const body = [
		`${PR_REVIEW_MARKER} Independent review: ${items.length} finding${items.length === 1 ? "" : "s"}${blockers ? `, ${blockers} blocker${blockers === 1 ? "" : "s"}` : ""}.`,
		...(loose.length > 0 ? ["", ...loose] : []),
	].join("\n");
	return { event: blockers > 0 ? "REQUEST_CHANGES" : "COMMENT", body, comments };
}
