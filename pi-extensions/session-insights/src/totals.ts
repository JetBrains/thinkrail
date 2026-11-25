import type { Origin, TokenTotals } from "./core.ts";

export interface SpendTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	unpricedTokens: number;
}

export interface Spend {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function emptySpend(): SpendTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpricedTokens: 0 };
}

export function tokensOf(spend: Spend): number {
	return spend.input + spend.output + spend.cacheRead + spend.cacheWrite;
}

export function usageSpend(usage: unknown): Spend | null {
	if (!isRecord(usage)) return null;
	return {
		input: count(usage.input),
		output: count(usage.output),
		cacheRead: count(usage.cacheRead),
		cacheWrite: count(usage.cacheWrite),
		cost: isRecord(usage.cost) ? count(usage.cost.total) : 0,
	};
}

export function spendOf(entry: unknown): Spend | null {
	if (!isRecord(entry)) return null;
	if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary")
		return usageSpend(entry.usage);
	if (entry.type !== "message" || !isRecord(entry.message)) return null;
	const { role, usage } = entry.message;
	return role === "assistant" || role === "toolResult" ? usageSpend(usage) : null;
}

export function addSpend(totals: SpendTotals, spend: Spend): void {
	totals.input += spend.input;
	totals.output += spend.output;
	totals.cacheRead += spend.cacheRead;
	totals.cacheWrite += spend.cacheWrite;
	totals.cost += spend.cost;
	if (spend.cost === 0) totals.unpricedTokens += tokensOf(spend);
}

export function recordedTotals(entries: readonly unknown[]): SpendTotals {
	const totals = emptySpend();
	for (const entry of entries) {
		const spend = spendOf(entry);
		if (spend) addSpend(totals, spend);
	}
	return totals;
}

/** `recorded` when every spend-bearing entry with tokens is priced, `notRecorded` when none is. */
export function costOrigin(spend: SpendTotals): Origin {
	if (spend.unpricedTokens === 0) return "recorded";
	return spend.cost === 0 ? "notRecorded" : "partiallyRecorded";
}

export function tokenTotals(spend: Spend): TokenTotals {
	return {
		input: spend.input,
		output: spend.output,
		cacheRead: spend.cacheRead,
		cacheWrite: spend.cacheWrite,
		total: tokensOf(spend),
	};
}
