export const DEFAULT_MAX_AGENTS = 1000;
const DEFAULT_MAX_BATCH_ITEMS = 4096;

export class RailError extends Error {}

export interface RailLimits {
	maxAgents?: number;
	maxBatchItems?: number;
	agentTimeoutMs?: number;
	maxCost?: number;
}

const positive = (value: number | undefined) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

export const createRails = ({
	runId,
	emit,
	...limits
}: RailLimits & { runId: string; emit: (line: string) => void }) => {
	const maxAgents = positive(limits.maxAgents) ?? DEFAULT_MAX_AGENTS;
	const maxBatchItems = positive(limits.maxBatchItems) ?? DEFAULT_MAX_BATCH_ITEMS;
	const agentTimeoutMs = positive(limits.agentTimeoutMs);
	const maxCost = positive(limits.maxCost);
	const breaches: RailError[] = [];
	let ceilingBreach: RailError | undefined;

	const resumeHint = (param: string) =>
		`raise ${param} and call the tool again with resumeFromRunId "${runId}" to keep the finished work`;

	const breach = (message: string, stopsRun = true): never => {
		const error = new RailError(message);
		breaches.push(error);
		if (stopsRun) ceilingBreach ??= error;
		throw error;
	};

	return {
		agentTimeoutMs,
		breach,
		mark: () => breaches.length,
		raisedSince: (mark: number) => breaches.length > mark,
		rethrowBreach: <T>(results: T, raisedBefore: number): T => {
			const swallowed = breaches[raisedBefore];
			if (swallowed) throw swallowed;
			return results;
		},
		assertRunnable: () => {
			if (ceilingBreach) breach(ceilingBreach.message);
		},
		assertAgentCap: (agentSeq: number) => {
			if (agentSeq < maxAgents) return;
			const message = `run agent ceiling reached (${maxAgents} agents in ${runId}); ${resumeHint("maxAgents")}`;
			emit(`✗ ${message}`);
			breach(message);
		},
		assertCostBudget: (totalCost: number) => {
			if (maxCost === undefined || totalCost < maxCost) return;
			const digits = maxCost < 1 ? 4 : 2;
			breach(
				`run cost ceiling reached ($${totalCost.toFixed(digits)} of $${maxCost.toFixed(digits)} limit); ` +
					`${resumeHint("maxCost")} (the ceiling is per run: a resume starts a fresh budget)`,
			);
		},
		assertBatchSize: (fn: "parallel" | "pipeline", count: number) => {
			if (count <= maxBatchItems) return;
			breach(
				`${fn}() received ${count} items; the limit is ${maxBatchItems}. Chunk the work.`,
				false,
			);
		},
	};
};

export type Rails = ReturnType<typeof createRails>;
