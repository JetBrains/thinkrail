import type {
	ChainAttempt,
	ChainStep,
	DiffSegment,
	ErrorDetail,
	ErrorDetailParams,
	SessionAnalysis,
	SubagentGetParams,
} from "./core.ts";
import { mainArgument } from "./facts.ts";
import { analyseFriction } from "./friction.ts";
import { parseSessionParams } from "./list.ts";
import { analysePlan } from "./plan.ts";
import { isRecord } from "./totals.ts";
import { type BuiltTrace, contentText } from "./trace.ts";
import type { TraceStore } from "./traceStore.ts";

const ARGUMENT_CHARS = 2000;
const ERROR_CHARS = 800;
const DIFF_TOKENS = 600;
const CHILD_ID_MAX = 200;
const CHAIN_MAX = 1_000_000;

/** The per-session analysis: plan, skills, turn badges, repeats, recovery chains and clusters. */
export function buildSessionAnalysis(
	trace: BuiltTrace,
	transcripts: readonly string[],
): SessionAnalysis {
	const plan = analysePlan(trace);
	const friction = analyseFriction(trace);
	return {
		revision: trace.meta.revision,
		plan: plan.plan,
		skills: plan.skills,
		turns: plan.turns,
		...friction,
		transcripts: [...transcripts].sort(),
	};
}

export function parseErrorDetailParams(value: unknown): ErrorDetailParams {
	const method = "error.detail";
	const { sessionId } = parseSessionParams(value, method);
	const chain = isRecord(value) ? value.chain : undefined;
	if (typeof chain !== "number" || !Number.isInteger(chain) || chain < 0 || chain > CHAIN_MAX)
		throw new Error(`Invalid ${method} params`);
	return { sessionId, chain };
}

export function parseChildId(value: unknown, method: string): string | undefined {
	const childId = isRecord(value) ? value.childId : undefined;
	if (childId === undefined) return undefined;
	if (typeof childId === "string" && childId.length > 0 && childId.length <= CHILD_ID_MAX)
		return childId;
	throw new Error(`Invalid ${method} params`);
}

export function parseSubagentParams(value: unknown): SubagentGetParams {
	const method = "subagent.get";
	const { sessionId } = parseSessionParams(value, method);
	const childId = parseChildId(value, method);
	if (!childId) throw new Error(`Invalid ${method} params`);
	return { sessionId, childId };
}

function tokens(text: string): string[] {
	return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/** Word-level difference by longest common subsequence; `null` past `DIFF_TOKENS` words a side. */
export function wordDiff(before: string, after: string): DiffSegment[] | null {
	const a = tokens(before);
	const b = tokens(after);
	if (a.length > DIFF_TOKENS || b.length > DIFF_TOKENS) return null;
	const rows = a.length + 1;
	const cols = b.length + 1;
	const table = new Uint16Array(rows * cols);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			table[i * cols + j] =
				a[i] === b[j]
					? (table[(i + 1) * cols + j + 1] ?? 0) + 1
					: Math.max(table[(i + 1) * cols + j] ?? 0, table[i * cols + j + 1] ?? 0);
	const out: DiffSegment[] = [];
	const push = (op: DiffSegment["op"], text: string) => {
		const last = out.at(-1);
		if (last?.op === op) last.text += text;
		else out.push({ op, text });
	};
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			push("same", a[i] ?? "");
			i += 1;
			j += 1;
		} else if ((table[(i + 1) * cols + j] ?? 0) >= (table[i * cols + j + 1] ?? 0)) {
			push("removed", a[i] ?? "");
			i += 1;
		} else {
			push("added", b[j] ?? "");
			j += 1;
		}
	}
	for (; i < a.length; i++) push("removed", a[i] ?? "");
	for (; j < b.length; j++) push("added", b[j] ?? "");
	return out;
}

export function callArguments(
	entry: Record<string, unknown>,
	callIndex: number | undefined,
): unknown {
	const message = isRecord(entry.message) ? entry.message : {};
	const blocks = Array.isArray(message.content) ? message.content : [];
	let calls = 0;
	for (const block of blocks) {
		if (!isRecord(block) || block.type !== "toolCall") continue;
		if (calls === (callIndex ?? 0)) return block.arguments;
		calls += 1;
	}
	return undefined;
}

/** A recovery chain's attempts with their arguments, word diffs, errors and the calls between them. */
export async function buildErrorDetail(
	store: TraceStore,
	file: string,
	trace: BuiltTrace,
	index: number,
): Promise<ErrorDetail | null> {
	const friction = analyseFriction(trace);
	const chain = friction.chains[index];
	if (!chain) return null;
	const redactor = store.redaction;
	const byId = new Map(trace.events.map((event) => [event.id, event]));
	const attempts: ChainAttempt[] = [];
	let previous: string | null = null;
	for (const [k, eventId] of chain.attempts.entries()) {
		const event = byId.get(eventId);
		if (!event) continue;
		const read = await store.read(file, eventId);
		let argument: ChainAttempt["argument"] = null;
		let error: ChainAttempt["error"] = null;
		if (read && event.kind === "tool") {
			const args = callArguments(read.parsed.entry, read.source.callIndex);
			const main = args === undefined ? "" : mainArgument(args);
			argument = main ? redactor.cap(main, ARGUMENT_CHARS) : null;
			const result =
				read.parsed.result && isRecord(read.parsed.result.message)
					? read.parsed.result.message
					: null;
			if (event.error && result) error = redactor.cap(contentText(result.content), ERROR_CHARS);
		} else if (read && event.kind === "llm") {
			const message = isRecord(read.parsed.entry.message) ? read.parsed.entry.message : {};
			const text =
				typeof message.errorMessage === "string" ? message.errorMessage : (event.stop ?? "");
			if (event.error && text) error = redactor.cap(text, ERROR_CHARS);
		}
		const between: ChainStep[] = (k > 0 ? (chain.between[k - 1] ?? []) : []).flatMap((id) => {
			const step = byId.get(id);
			if (step?.kind !== "tool") return [];
			return [
				{
					eventId: id,
					tool: step.tool,
					label: step.label,
					failed: step.error === true,
					...(step.missing ? { missing: true as const } : {}),
					edit: trace.facts.get(id)?.call?.edit === true,
				},
			];
		});
		attempts.push({
			eventId,
			t0: event.t0,
			t1: event.t1,
			failed: event.error === true,
			...(event.kind === "tool" && event.missing ? { missing: true as const } : {}),
			exit: event.kind === "tool" ? (event.exit ?? null) : null,
			model: event.kind === "llm" ? event.model : null,
			argument,
			diff: argument && previous !== null ? wordDiff(previous, argument.text) : null,
			error,
			between,
		});
		previous = argument?.text ?? previous;
	}
	return {
		chain,
		attempts,
		cluster: chain.cluster === null ? null : (friction.clusters[chain.cluster] ?? null),
	};
}
