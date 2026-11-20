import type { ReviewComment } from "@thinkrail/contracts";
import { runReviewSubagent } from "../agent";
import type {
	ExtensionAddedReviewComment,
	ExtensionConformanceItem,
	ExtensionConformanceRequirement,
	ExtensionConformanceResult,
	ExtensionReviewCommentInput,
} from "../extensions";
import { workspaceRelativePath } from "../fs";
import { addComment, anchorProblem, deleteComment } from "../reviews";
import { type ReviewRunner, reviewerChoice } from "./requestReview";
import {
	CONFORMANCE_OUTPUT_CONTRACT,
	CONFORMANCE_SYSTEM_PROMPT,
	REVIEWER_TOOLS,
} from "./reviewerRole";
import { withReviewLock } from "./reviewLock";

const VERDICTS = new Set(["met", "unmet", "untested"]);
const MAX_EVIDENCE = 10;
const MAX_TESTS = 20;
const MAX_NOTE = 1_000;
const MAX_SUMMARY = 2_000;

let conformanceRunner: ReviewRunner = runReviewSubagent;

/** The e2e seam: a deterministic reviewer in place of the delegated child. See planReview.SPEC.md. */
export function setConformanceReviewRunner(runner: ReviewRunner): void {
	conformanceRunner = runner;
}

export interface ConformanceRun {
	workspaceId: string;
	/** The live chat the hidden reviewer child runs under. */
	sessionId: string;
	worktreePath: string;
	baseBranch: string;
	requirements: readonly ExtensionConformanceRequirement[];
	context: string;
	signal: AbortSignal;
}

/** The reviewer's task: what the change is for, the base to diff against, and every requirement by id. */
export function conformanceTask(
	input: Pick<ConformanceRun, "baseBranch" | "requirements" | "context">,
): string {
	const requirements = input.requirements.map((requirement) => {
		const scenarios = (requirement.scenarios ?? []).map(
			(scenario) => `  - Scenario: ${scenario.replace(/\n/g, "\n    ")}`,
		);
		return [`- [${requirement.id}] ${requirement.text.replace(/\n/g, "\n  ")}`, ...scenarios].join(
			"\n",
		);
	});
	return [
		"# Conformance review",
		"",
		input.context.trim() ? `## Context\n\n${input.context.trim()}\n` : "",
		"## The change",
		"",
		`The workspace's change is its branch against \`${input.baseBranch}\` (\`git diff ${input.baseBranch}...HEAD\`) plus its uncommitted work (\`git status\`, \`git diff\`).`,
		"",
		"## Requirements",
		"",
		...requirements,
	]
		.filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
		.join("\n");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function evidencePath(path: string): string {
	return path.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function lastJsonBlock(text: string): string {
	const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)];
	return blocks.at(-1)?.[1] ?? text;
}

function readItem(raw: unknown): ExtensionConformanceItem | null {
	if (!isRecord(raw) || typeof raw.id !== "string") return null;
	if (typeof raw.verdict !== "string" || !VERDICTS.has(raw.verdict)) return null;
	const evidence: ExtensionConformanceItem["evidence"] = [];
	for (const entry of Array.isArray(raw.evidence) ? raw.evidence : []) {
		if (!isRecord(entry) || typeof entry.path !== "string" || !evidencePath(entry.path))
			return null;
		const { line } = entry;
		if (line !== undefined && line !== null && !(Number.isInteger(line) && (line as number) >= 1))
			return null;
		evidence.push({
			path: evidencePath(entry.path),
			...(typeof line === "number" ? { line } : {}),
			note: clip(typeof entry.note === "string" ? entry.note.trim() : "", MAX_NOTE),
		});
	}
	if (raw.evidence !== undefined && !Array.isArray(raw.evidence)) return null;
	if (raw.tests !== undefined && !Array.isArray(raw.tests)) return null;
	const tests = (Array.isArray(raw.tests) ? raw.tests : [])
		.filter((test): test is string => typeof test === "string" && test.trim() !== "")
		.map((test) => clip(test.trim(), MAX_NOTE));
	return {
		id: raw.id,
		verdict: raw.verdict as ExtensionConformanceItem["verdict"],
		evidence: evidence.slice(0, MAX_EVIDENCE),
		tests: tests.slice(0, MAX_TESTS),
	};
}

/**
 * The reviewer's fenced-JSON verdict, validated: every requirement exactly one well-formed item (unknown
 * ids dropped), in the requirements' order; `null` for anything else. Model output is untrusted.
 */
export function parseConformance(
	finalText: string | undefined,
	requirements: readonly Pick<ExtensionConformanceRequirement, "id">[],
): ExtensionConformanceResult | null {
	if (!finalText) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(lastJsonBlock(finalText).trim());
	} catch {
		return null;
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.items)) return null;
	if (parsed.summary !== undefined && typeof parsed.summary !== "string") return null;
	const wanted = new Set(requirements.map((requirement) => requirement.id));
	const byId = new Map<string, ExtensionConformanceItem>();
	for (const raw of parsed.items) {
		const item = readItem(raw);
		if (!item) return null;
		if (!wanted.has(item.id)) continue;
		if (byId.has(item.id)) return null;
		byId.set(item.id, item);
	}
	const items: ExtensionConformanceItem[] = [];
	for (const requirement of requirements) {
		const item = byId.get(requirement.id);
		if (!item) return null;
		items.push(item);
	}
	return { items, summary: clip((parsed.summary ?? "").trim(), MAX_SUMMARY) };
}

/** Plan review's hidden reviewer child, on its model, with the conformance role; advisory only. */
export async function runConformanceReview(
	input: ConformanceRun,
	runner: ReviewRunner = conformanceRunner,
): Promise<ExtensionConformanceResult> {
	const run = await runner(
		input.workspaceId,
		input.sessionId,
		`${conformanceTask(input)}\n\n${CONFORMANCE_OUTPUT_CONTRACT}`,
		{
			systemPrompt: CONFORMANCE_SYSTEM_PROMPT,
			tools: REVIEWER_TOOLS,
			info: { createdBy: "extension:reviewConformance", roleName: "conformance-reviewer" },
			...(await reviewerChoice()),
		},
		input.signal,
	);
	if (run.status !== "completed")
		throw new Error(`The conformance reviewer did not complete (${run.status}).`);
	const result = parseConformance(run.finalText, input.requirements);
	if (!result) throw new Error("The conformance reviewer did not return a valid verdict.");
	return {
		...result,
		items: result.items.map((item) => ({
			...item,
			evidence: item.evidence.map((entry) => ({
				...entry,
				path: workspaceRelativePath(input.worktreePath, entry.path) || entry.path,
			})),
		})),
	};
}

async function fileOne(
	workspaceId: string,
	authorLabel: string,
	input: ExtensionReviewCommentInput,
): Promise<{ comment: ReviewComment; anchored: boolean }> {
	const agent = { author: "agent" as const, authorLabel };
	const anchorable = input.side === "base" || !anchorProblem(workspaceId, input.path, input.line);
	if (anchorable) {
		try {
			const comment = await addComment({
				workspaceId,
				kind: "inline",
				body: input.text,
				...agent,
				anchor: {
					path: input.path,
					side: input.side,
					contentHash: "",
					selectors: [{ kind: "lineRange", startLine: input.line, endLine: input.line }],
				},
			});
			return { comment, anchored: true };
		} catch (error) {
			if (input.side !== "base") throw error;
		}
	}
	const comment = await addComment({
		workspaceId,
		kind: "review",
		body: `${input.path}:${input.line} — ${input.text}`,
		...agent,
		anchor: null,
	});
	return { comment, anchored: false };
}

/**
 * Files an extension's remarks as agent comments labelled with its title, all or nothing, under the
 * workspace's review lock; a line that does not resolve becomes a review-level remark naming it.
 */
export async function fileExtensionComments(
	workspaceId: string,
	authorLabel: string,
	comments: readonly ExtensionReviewCommentInput[],
): Promise<ExtensionAddedReviewComment[]> {
	return withReviewLock(workspaceId, async () => {
		const filed: ExtensionAddedReviewComment[] = [];
		try {
			for (const input of comments) {
				const { comment, anchored } = await fileOne(workspaceId, authorLabel, input);
				filed.push({ id: comment.id, path: input.path, line: input.line, anchored });
			}
		} catch (error) {
			for (const comment of filed) await deleteComment(workspaceId, comment.id).catch(() => {});
			throw error;
		}
		return filed;
	});
}
