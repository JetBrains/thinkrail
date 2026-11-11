import { expect, test } from "bun:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { compact } from "@earendil-works/pi-coding-agent";

test("turn-prefix summaries have answer room independent of the compaction reserve", async () => {
	const faux = createFauxCore({
		models: [
			{ id: "summary-cap-probe", reasoning: false, contextWindow: 200_000, maxTokens: 64_000 },
		],
		tokensPerSecond: 100_000,
	});
	const model = faux.getModel();
	const outputBudgets: number[] = [];
	const requiredOutput = 20_000;
	for (const reserveTokens of [16_384, 80_000]) {
		faux.setResponses([
			(_context, options) => {
				const outputBudget = options?.maxTokens ?? model.maxTokens;
				outputBudgets.push(outputBudget);
				return fauxAssistantMessage("Complete turn prefix", {
					stopReason: outputBudget < requiredOutput ? "length" : "stop",
				});
			},
		]);
		const result = await compact(
			{
				firstKeptEntryId: "kept",
				messagesToSummarize: [],
				turnPrefixMessages: [{ role: "user", content: "Current work", timestamp: 1 }],
				isSplitTurn: true,
				tokensBefore: 10_000,
				fileOps: { read: new Set(), written: new Set(), edited: new Set() },
				settings: { enabled: true, reserveTokens, keepRecentTokens: 20_000 },
			},
			model,
			"fixture",
			undefined,
			undefined,
			undefined,
			undefined,
			faux.streamSimple,
		);
		expect(result.summary).toContain("Complete turn prefix");
	}
	expect(outputBudgets).toHaveLength(2);
	expect(outputBudgets[0]).toBe(outputBudgets[1]);
	expect(outputBudgets[0]).toBeGreaterThanOrEqual(requiredOutput);
});
