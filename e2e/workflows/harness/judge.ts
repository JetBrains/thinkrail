import "./env";
import { completeOnce } from "@thinkrail/server/agent";

export type JudgeVerdict = "pass" | "fail" | "unclear";

export interface JudgeItem {
	statement: string;
	verdict: JudgeVerdict;
	evidence: string;
}

export interface JudgeResult {
	status: "ok" | "skipped" | "error";
	items: JudgeItem[];
}

const JUDGE_SYSTEM = [
	"You grade an automated test transcript of a coding agent against rubric statements. For each",
	"statement decide pass (clearly true), fail (clearly false), or unclear — and quote the shortest",
	"evidence snippet from the transcript.",
	'Reply ONLY a JSON array: [{"statement":"…","verdict":"pass|fail|unclear","evidence":"…"}, …]',
	"in rubric order, no markdown, no commentary.",
].join(" ");

export function parseJudgeReply(reply: string, rubric: string[]): JudgeItem[] {
	const unclear = (): JudgeItem[] =>
		rubric.map((statement) => ({
			statement,
			verdict: "unclear",
			evidence: "unparseable judge reply",
		}));
	const jsonMatch = reply.match(/\[[\s\S]*\]/);
	if (!jsonMatch) return unclear();
	let parsed: Array<{ statement?: string; verdict?: string; evidence?: string }>;
	try {
		parsed = JSON.parse(jsonMatch[0]);
	} catch {
		return unclear();
	}
	if (!Array.isArray(parsed)) return unclear();
	return rubric.map((statement, i) => {
		const entry = parsed[i];
		const verdict =
			entry?.verdict === "pass" || entry?.verdict === "fail" || entry?.verdict === "unclear"
				? entry.verdict
				: "unclear";
		return { statement, verdict, evidence: String(entry?.evidence ?? "") };
	});
}

export async function judgeTranscript(transcript: string, rubric: string[]): Promise<JudgeResult> {
	if (rubric.length === 0) return { status: "skipped", items: [] };
	try {
		const { text } = await completeOnce({
			system: JUDGE_SYSTEM,
			prompt: `Rubric:\n${rubric.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nTranscript:\n${transcript}`,
			tier: "cheap",
			maxTokens: 1024,
		});
		return { status: "ok", items: parseJudgeReply(text, rubric) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "no-model") return { status: "skipped", items: [] };
		return {
			status: "error",
			items: rubric.map((statement) => ({ statement, verdict: "unclear", evidence: message })),
		};
	}
}
