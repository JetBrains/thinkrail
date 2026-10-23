import { expect, test } from "bun:test";
import type { SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { buildBaseOptions } from "@earendil-works/pi-ai/api/simple-options";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import {
	compact,
	generateBranchSummary,
	generateSummaryWithUsage,
} from "@earendil-works/pi-coding-agent";

function summarizer(reasoning = true) {
	const requests: { context: TranscriptContext; options: SimpleStreamOptions | undefined }[] = [];
	const faux = createFauxCore({
		models: [{ id: "summary-probe", reasoning, contextWindow: 200_000, maxTokens: 64_000 }],
		tokensPerSecond: 100_000,
	});
	faux.setResponses(
		Array.from({ length: 2 }, (_, index) => (context, options) => {
			requests.push({ context, options });
			return fauxAssistantMessage(`Complete summary ${index + 1}`);
		}),
	);
	const usageTotals: number[] = [];
	const stream: NonNullable<Parameters<typeof compact>[7]> = (...args) => {
		const result = faux.streamSimple(...args);
		void result.result().then((response) => usageTotals.push(response.usage.totalTokens));
		return result;
	};
	return { faux, requests, model: faux.getModel(), stream, usageTotals };
}

function preparation(split: boolean, reserveTokens: number): Parameters<typeof compact>[0] {
	return {
		firstKeptEntryId: "kept",
		messagesToSummarize: [{ role: "user", content: "Earlier work", timestamp: 1 }],
		turnPrefixMessages: split ? [{ role: "user", content: "Current work", timestamp: 2 }] : [],
		isSplitTurn: split,
		tokensBefore: 10_000,
		fileOps: { read: new Set(["input.ts"]), written: new Set(), edited: new Set(["output.ts"]) },
		settings: { enabled: true, reserveTokens, keepRecentTokens: 20_000 },
	};
}

for (const reserve of [0, 16_384, 80_000]) {
	for (const split of [false, true]) {
		test(`summary output is independent of reserve ${reserve}, split=${split}`, async () => {
			const { stream, usageTotals, requests, model } = summarizer();
			const signal = new AbortController().signal;
			const result = await compact(
				preparation(split, reserve),
				model,
				"fixture",
				undefined,
				"Preserve exact filenames",
				signal,
				"xhigh",
				stream,
			);
			expect(requests).toHaveLength(split ? 2 : 1);
			for (const { context, options } of requests) {
				expect(options?.maxTokens).toBeUndefined();
				expect(options?.reasoning).toBe("xhigh");
				expect(options?.signal).toBe(signal);
				expect(options?.cacheRetention).toBe("none");
				expect(JSON.stringify(context)).toContain("Preserve exact filenames");
				expect(buildBaseOptions(model, context, options).maxTokens).toBe(model.maxTokens);
				const constrained = { ...model, contextWindow: 6_000 };
				const capped = buildBaseOptions(constrained, context, options).maxTokens;
				expect(capped).toBeGreaterThan(0);
				expect(capped).toBeLessThan(6_000);
			}
			expect(result.firstKeptEntryId).toBe("kept");
			expect(result.summary).toContain("input.ts");
			expect(result.summary).toContain("output.ts");
			expect(usageTotals).toHaveLength(requests.length);
			expect(result.usage?.totalTokens).toBe(usageTotals.reduce((sum, total) => sum + total, 0));
		});
	}
}

test("a prefix-only summary keeps prior history, instructions and model-sized answer room", async () => {
	const { faux, requests, model } = summarizer();
	const input = preparation(true, 16_384);
	input.messagesToSummarize = [];
	input.previousSummary = "Previously completed work";
	faux.setResponses([
		(context, options) => {
			requests.push({ context, options });
			return fauxAssistantMessage("Complete turn prefix", {
				stopReason:
					options?.maxTokens !== undefined && options.maxTokens < 20_000 ? "length" : "stop",
			});
		},
	]);
	const result = await compact(
		input,
		model,
		"fixture",
		undefined,
		"Keep next steps",
		undefined,
		"xhigh",
		faux.streamSimple,
	);
	expect(requests).toHaveLength(1);
	expect(JSON.stringify(requests[0]?.context)).toContain("Keep next steps");
	expect(result.summary).toContain("Previously completed work");
	expect(result.summary).toContain("Complete turn prefix");
});

test("history updates keep the public reserve argument without imposing an output cap", async () => {
	const { faux, requests, model } = summarizer();
	const result = await generateSummaryWithUsage(
		preparation(false, 1).messagesToSummarize,
		model,
		1,
		"fixture",
		undefined,
		undefined,
		"Keep decisions",
		"Previous summary",
		"high",
		faux.streamSimple,
	);
	expect(result.text).toBe("Complete summary 1");
	expect(requests[0]?.options?.maxTokens).toBeUndefined();
	expect(JSON.stringify(requests[0]?.context)).toContain("Previous summary");
});

for (const [reasoning, effort] of [
	[true, "off"],
	[false, "high"],
] as const) {
	test(`summary omits reasoning when model reasoning=${reasoning} and effort=${effort}`, async () => {
		const { faux, requests, model } = summarizer(reasoning);
		await compact(
			preparation(false, 16_384),
			model,
			"fixture",
			undefined,
			undefined,
			undefined,
			effort,
			faux.streamSimple,
		);
		expect(requests[0]?.options?.reasoning).toBeUndefined();
		expect(requests[0]?.options?.maxTokens).toBeUndefined();
	});
}

for (const split of [false, true]) {
	test(`an actual length-limited summary is still rejected, split=${split}`, async () => {
		const { faux, model } = summarizer();
		const input = preparation(split, 16_384);
		if (split) input.messagesToSummarize = [];
		faux.setResponses([fauxAssistantMessage("Incomplete summary", { stopReason: "length" })]);
		await expect(
			compact(input, model, "fixture", undefined, undefined, undefined, "high", faux.streamSimple),
		).rejects.toThrow(
			`${split ? "Turn prefix summarization" : "Summarization"} failed: generation hit the token cap and the summary is incomplete`,
		);
		expect(faux.state.callCount).toBe(1);
	});
}

test("branch summaries do not restore the separate fixed output cap", async () => {
	const { faux, requests, model } = summarizer();
	const result = await generateBranchSummary(
		[
			{
				type: "message",
				id: "user",
				parentId: null,
				timestamp: new Date(0).toISOString(),
				message: { role: "user", content: "Preserve this abandoned branch", timestamp: 1 },
			},
		],
		{ model, apiKey: "fixture", signal: new AbortController().signal, streamFn: faux.streamSimple },
	);
	expect(requests).toHaveLength(1);
	expect(requests[0]?.options?.maxTokens).toBeUndefined();
	expect(result.summary).toContain("Complete summary 1");
});
