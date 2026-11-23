import type { SessionSummary, SubagentRef } from "./summary.ts";
import { type Spend, tokensOf } from "./totals.ts";

const COST_EPSILON = 1e-9;

export interface SubagentJoin {
	count: number;
	measured: boolean;
	outside: { cost: number; tokens: number };
	/** Each child's share of `outside`, by child id; children with none are left out. */
	children: { childId: string; cost: number; tokens: number }[];
}

const ZERO: Spend = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

export function outsideSpend(best: Spend, mirrored: Spend | null): Spend {
	const base = mirrored ?? ZERO;
	const missing: Spend = {
		input: best.input - base.input,
		output: best.output - base.output,
		cacheRead: best.cacheRead - base.cacheRead,
		cacheWrite: best.cacheWrite - base.cacheWrite,
		cost: best.cost - base.cost,
	};
	if ([missing.input, missing.output, missing.cacheRead, missing.cacheWrite].some((n) => n < 0))
		return ZERO;
	return missing.cost > COST_EPSILON ? missing : { ...missing, cost: 0 };
}

function refOf(parent: SessionSummary, childId: string): SubagentRef | undefined {
	return Object.hasOwn(parent.subagents, childId) ? parent.subagents[childId] : undefined;
}

export function joinSubagents(
	parent: SessionSummary,
	children: readonly SessionSummary[],
): SubagentJoin {
	const transcripts = new Map<string, SessionSummary>();
	for (const child of children) {
		if (child.sessionId !== parent.sessionId && !transcripts.has(child.sessionId))
			transcripts.set(child.sessionId, child);
	}
	const ids = [...new Set([...Object.keys(parent.subagents), ...transcripts.keys()])].sort();
	const outside = { cost: 0, tokens: 0 };
	const perChild: SubagentJoin["children"] = [];
	let measured = true;
	for (const childId of ids) {
		const ref = refOf(parent, childId);
		const child = transcripts.get(childId);
		const transcript = child && child.parentSession === null ? child.spend : null;
		if (!transcript && !ref?.reported) measured = false;
		const best = transcript ?? ref?.reported ?? ref?.mirrored ?? null;
		if (!best) continue;
		const missing = outsideSpend(best, ref?.mirrored ?? null);
		outside.cost += missing.cost;
		outside.tokens += tokensOf(missing);
		if (missing.cost > 0 || tokensOf(missing) > 0)
			perChild.push({ childId, cost: missing.cost, tokens: tokensOf(missing) });
	}
	return { count: ids.length, measured, outside, children: perChild };
}
