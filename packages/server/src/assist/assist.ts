import { completeOnce, type OneShotRequest, type OneShotResult } from "../agent";

export type OneShotRunner = (req: OneShotRequest) => Promise<OneShotResult>;

let runOneShot: OneShotRunner = completeOnce;

export function setOneShotRunner(fn: OneShotRunner | null): void {
	runOneShot = fn ?? completeOnce;
}

const PLAN_SUMMARY_SYSTEM =
	"Summarize a COMPLETED work plan for a reviewer, from its finished steps (each step's title and the " +
	"agent's own note/verification), as the body of a pull request. Output GitHub Markdown with exactly " +
	"three H2 sections in order and nothing before them: '## Summary' (what shipped and why in short " +
	"prose), '## Changes' (plan-scale cross-cutting notes \u2014 migrations, scope drift, new/dropped deps, " +
	"renames; write '_no cross-cutting notes_' if none), '## Testing' (end-to-end checks beyond " +
	"per-step verification, each as a bullet in the shape 'check \u2192 result', or the honest " +
	"'_not verified_'). No preamble before `## Summary`; never claim anything the steps don't state. " +
	"Keep the whole body under ~160 words.";

const PLAN_SUMMARY_TIMEOUT_MS = 20_000;
const PLAN_SUMMARY_MAX_TOKENS = 400;
const PLAN_SUMMARY_MAX_LENGTH = 2000;

export interface PlanSummaryStep {
	title: string;
	summary?: string | undefined;
	verification?: string | undefined;
}

/**
 * Draft a completed plan's overall handoff note from its finished steps — best-effort, cheap-model,
 * time-boxed. Returns Markdown prose or `null` (never throws) when nothing is authenticated, it times
 * out, there are no steps, or the output is unusable. The caller builds the step list (assist reads no
 * store state) and decides whether to persist the result.
 */
export async function suggestPlanSummary(steps: PlanSummaryStep[]): Promise<string | null> {
	const prompt = buildPlanSummaryPrompt(steps);
	if (!prompt) return null;
	try {
		const { text } = await runOneShot({
			system: PLAN_SUMMARY_SYSTEM,
			prompt,
			tier: "cheap",
			maxTokens: PLAN_SUMMARY_MAX_TOKENS,
			signal: AbortSignal.timeout(PLAN_SUMMARY_TIMEOUT_MS),
		});
		return toPlanSummary(text);
	} catch {
		return null;
	}
}

function buildPlanSummaryPrompt(steps: PlanSummaryStep[]): string | null {
	const lines = steps
		.map((step) => {
			const title = step.title.trim();
			if (!title) return null;
			const parts = [`- ${clip(title, 200)}`];
			const note = step.summary?.trim();
			if (note) parts.push(`  note: ${clip(note, 500)}`);
			const verified = step.verification?.trim();
			if (verified) parts.push(`  verified: ${clip(verified, 300)}`);
			return parts.join("\n");
		})
		.filter((line): line is string => line !== null);
	if (lines.length === 0) return null;
	return `Completed steps:\n${lines.join("\n")}`;
}

export function toPlanSummary(raw: string): string | null {
	const text = raw
		.trim()
		.replace(/^```[a-z]*\n?/i, "")
		.replace(/\n?```$/, "")
		.replace(/^\s*summary\s*:\s*/i, "")
		.trim()
		.slice(0, PLAN_SUMMARY_MAX_LENGTH)
		.trim();
	if (!hasTitleContent(text)) return null;
	return ensurePrBodyShape(text);
}

function ensurePrBodyShape(text: string): string {
	const sections = splitBySections(text);
	if (sections.ordered) return text;
	const summaryBody = sections.summary ?? (sections.preamble || "_no summary_");
	const changesBody = sections.changes ?? "_no cross-cutting notes_";
	const testingBody = sections.testing ?? "_not verified_";
	return `## Summary\n\n${summaryBody}\n\n## Changes\n\n${changesBody}\n\n## Testing\n\n${testingBody}`;
}

interface Sections {
	ordered: boolean;
	preamble: string;
	summary?: string;
	changes?: string;
	testing?: string;
}

function splitBySections(text: string): Sections {
	const HEADING = /^## +(Summary|Changes|Testing)\b.*$/gim;
	const matches = [...text.matchAll(HEADING)];
	const spans = matches.map((m) => ({
		name: m[1] as "Summary" | "Changes" | "Testing",
		headingStart: m.index ?? 0,
		bodyStart: (m.index ?? 0) + m[0].length,
	}));
	const body = (name: "Summary" | "Changes" | "Testing"): string | undefined => {
		const idx = spans.findIndex((s) => s.name === name);
		if (idx < 0) return undefined;
		// Stop at the next heading so a later section cannot be absorbed when an earlier one is missing.
		const end = spans[idx + 1]?.headingStart ?? text.length;
		const span = spans[idx];
		if (!span) return undefined;
		const slice = text.slice(span.bodyStart, end).trim();
		return slice || undefined;
	};
	const names = spans.map((s) => s.name);
	const ordered =
		names.length === 3 &&
		names[0] === "Summary" &&
		names[1] === "Changes" &&
		names[2] === "Testing";
	const preamble = text.slice(0, spans[0]?.headingStart ?? text.length).trim();
	const out: Sections = { ordered, preamble };
	const s = body("Summary");
	const c = body("Changes");
	const t = body("Testing");
	if (s) out.summary = s;
	if (c) out.changes = c;
	if (t) out.testing = t;
	return out;
}

function hasTitleContent(value: string): boolean {
	return /[\p{L}\p{N}]/u.test(value);
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}
