import { completeOnce, type OneShotRequest, type OneShotResult } from "../agent";

export type OneShotRunner = (req: OneShotRequest) => Promise<OneShotResult>;

let runOneShot: OneShotRunner = completeOnce;

export function setOneShotRunner(fn: OneShotRunner | null): void {
	runOneShot = fn ?? completeOnce;
}

const PLAN_SUMMARY_SYSTEM =
	"Summarize a COMPLETED work plan for a reviewer, from its finished steps (each step's title and the " +
	"agent's own note/verification). Write a short handoff in GitHub Markdown: a one-sentence lead, then a " +
	"compact bullet list of what shipped across the WHOLE plan \u2014 not a single step. No headings, no " +
	"'Summary:' label, no preamble; never claim anything the steps don't state. Keep it under ~120 words.";

const PLAN_SUMMARY_TIMEOUT_MS = 20_000;
const PLAN_SUMMARY_MAX_TOKENS = 400;
const PLAN_SUMMARY_MAX_LENGTH = 2000;

export interface PlanSummaryStep {
	title: string;
	summary?: string | undefined;
	verification?: string | undefined;
}

/**
 * Draft a completed plan's overall handoff note from its finished steps \u2014 best-effort, cheap-model,
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
	return hasTitleContent(text) ? text : null;
}

function hasTitleContent(value: string): boolean {
	return /[\p{L}\p{N}]/u.test(value);
}

function clip(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}
