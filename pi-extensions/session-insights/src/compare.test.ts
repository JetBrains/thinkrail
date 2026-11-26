import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tempDir, writeSession } from "../test/builders.ts";
import { type Call, rd, sessionOf, sh } from "../test/calls.ts";
import { placeByFolder, statsOver } from "../test/stats.ts";
import { buildSlicesCompare, parseCompareParams } from "./compare.ts";
import type { CompareMetricId, SlicesCompareParams } from "./core.ts";
import { bootstrapDifference, mulberry32, seedOf } from "./stats.ts";

const root = tempDir("compare");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const READY = { phase: "ready", indexed: 0, total: 0 } as const;
const ALL = { kind: "all" } as const;
const day = (date: number) => new Date(2026, 10, date, 10).getTime();

function calls(failed: number, total = 10): Call[] {
	return Array.from({ length: total }, (_, at) =>
		at < failed ? sh("bun test", true) : rd(`f${at}`),
	);
}

async function corpus() {
	const files: string[] = [];
	for (let k = 0; k < 4; k++)
		files.push(
			writeSession(
				root,
				`a${k}`,
				sessionOf(`a${k}`, [{ prompt: `fix the parser ${k}`, calls: calls(3) }], {
					start: day(1 + k),
					model: "claude-a",
					cost: 0.1,
				}),
			),
			writeSession(
				root,
				`b${k}`,
				sessionOf(`b${k}`, [{ prompt: `review the docs ${k}`, calls: calls(0) }], {
					start: day(11 + k),
					model: "claude-b",
					cost: 0,
				}),
			),
		);
	files.push(
		writeSession(
			root,
			"elsewhere",
			sessionOf("elsewhere", [{ prompt: "fix the notes", calls: calls(1) }], {
				cwd: "/work/b",
				start: day(5),
				model: "claude-a",
				cost: 0.1,
			}),
		),
	);
	return statsOver(files, { place: placeByFolder });
}

const metric = (result: Awaited<ReturnType<typeof buildSlicesCompare>>, id: CompareMetricId) =>
	result.compare.metrics.find((entry) => entry.id === id);

describe("bootstrap", () => {
	test("Mulberry32 and the seed are pinned", () => {
		const random = mulberry32(1);
		expect([random(), random(), random()]).toEqual([
			0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
		]);
		expect(seedOf("model\u0000a\u0000b\u0000tokens")).toBe(4137477099);
	});

	test("intervals are pinned for a seed and repeat exactly", async () => {
		const options = { resamples: 2000, seed: 42, level: 0.95 };
		const a = { values: [1, 2, 3, 4, 5] };
		const b = { values: [2, 4, 6, 8, 10] };
		expect(await bootstrapDifference("median", a, b, options)).toEqual({ low: -1, high: 7 });
		expect(await bootstrapDifference("median", a, b, options)).toEqual({ low: -1, high: 7 });
		expect(
			await bootstrapDifference(
				"ratio",
				{ values: [1, 0, 2, 1], weights: [10, 10, 10, 10] },
				{ values: [0, 0, 1, 0], weights: [10, 10, 10, 10] },
				{ ...options, seed: 7 },
			),
		).toEqual({ low: -0.15, high: 0 });
		expect(
			await bootstrapDifference(
				"mean",
				{ values: [0, 1, 0, 3] },
				{ values: [5, 4, 6] },
				{ ...options, seed: 7 },
			),
		).toEqual({ low: 2.416666666666667, high: 5.333333333333333 });
		expect(await bootstrapDifference("mean", { values: [] }, b, options)).toBeNull();
	});
});

describe("slices.compare", () => {
	test("params", () => {
		const scope = { kind: "project", projectId: "p1" } as const;
		expect(parseCompareParams({ scope, by: "model" })).toEqual({ scope, by: "model" });
		expect(parseCompareParams({ scope, by: "period", a: "2026-11-05" })).toEqual({
			scope,
			by: "period",
			a: "2026-11-05",
		});
		for (const bad of [
			{ scope, by: "mood" },
			{ scope, by: "period", a: "yesterday" },
			{ scope, by: "filter", a: 3 },
			{ scope: { kind: "x" }, by: "model" },
			null,
		])
			expect(() => parseCompareParams(bad)).toThrow("Invalid slices.compare params");
	});

	test("by model: a better failure share, an indistinguishable call count, cost without data", async () => {
		const { input } = await corpus();
		const params: SlicesCompareParams = {
			scope: ALL,
			by: "model",
			a: "anthropic/claude-a",
			b: "anthropic/claude-b",
		};
		const result = await buildSlicesCompare(input, READY, params);
		const { compare, sessions } = result;
		expect(compare.a.sessions).toHaveLength(5);
		expect(compare.b.sessions).toHaveLength(4);
		expect(compare.a.sessions.map((index) => sessions[index]?.sessionId)).toContain("elsewhere");
		expect(metric(result, "sessions")).toMatchObject({
			a: { value: 5 },
			b: { value: 4 },
			verdict: "none",
		});
		const failed = metric(result, "failedShare");
		expect(failed?.a.value).toBeCloseTo(13 / 50);
		expect(failed?.b.value).toBe(0);
		expect(failed?.verdict).toBe("better");
		expect(failed?.high ?? 0).toBeLessThan(0);
		expect(failed?.sampleA.values).toHaveLength(5);
		expect(metric(result, "toolCalls")).toMatchObject({
			a: { value: 10 },
			b: { value: 10 },
			delta: 0,
			low: 0,
			high: 0,
			verdict: "same",
		});
		expect(metric(result, "cost")).toMatchObject({ verdict: "noData", b: { value: null } });
		expect(metric(result, "turns")).toMatchObject({ verdict: "same", direction: "neutral" });
		expect(compare.distinguishable).toBeGreaterThanOrEqual(1);
		expect(compare.confounds.map((confound) => confound.kind)).toContain("time");
		expect(compare.options.models).toEqual([
			{ key: "anthropic/claude-a", name: null, sessions: 5 },
			{ key: "anthropic/claude-b", name: null, sessions: 4 },
		]);
		const again = await buildSlicesCompare(input, READY, params);
		expect(JSON.stringify(again.compare)).toBe(JSON.stringify(compare));
	});

	test("defaults pick the two largest models; too few sessions get no interval", async () => {
		const { input } = await corpus();
		const byModel = await buildSlicesCompare(input, READY, { scope: ALL, by: "model" });
		expect([byModel.compare.a.key, byModel.compare.b.key]).toEqual([
			"anthropic/claude-a",
			"anthropic/claude-b",
		]);
		const byProject = await buildSlicesCompare(input, READY, {
			scope: ALL,
			by: "project",
			a: "p1",
			b: "p2",
		});
		expect(byProject.compare.a.name).toBe("Alpha");
		expect(byProject.compare.b.sessions).toHaveLength(1);
		expect(metric(byProject, "toolCalls")).toMatchObject({ verdict: "tooFew", low: null });
	});

	test("by period splits on a day, and a model mix that coincides is a confound", async () => {
		const { input } = await corpus();
		const result = await buildSlicesCompare(input, READY, {
			scope: ALL,
			by: "period",
			a: "2026-11-10",
		});
		expect(result.compare.a.sessions).toHaveLength(5);
		expect(result.compare.b.sessions).toHaveLength(4);
		const models = result.compare.confounds.find((confound) => confound.kind === "models");
		expect(models).toMatchObject({
			kind: "models",
			a: "anthropic/claude-a",
			b: "anthropic/claude-b",
		});
		expect(result.compare.confounds.some((confound) => confound.kind === "time")).toBe(false);
	});

	test("by label: the user's labels, case-insensitively, against another label or the rest", async () => {
		const { input } = await corpus();
		const labels = new Map([
			["a0", ["Good"]],
			["a1", ["good"]],
			["b0", ["bad"]],
			["b1", ["bad", "good"]],
		]);
		input.labelsOf = (sessionId) => labels.get(sessionId) ?? [];
		const picked = await buildSlicesCompare(input, READY, { scope: ALL, by: "label" });
		expect(picked.compare.options.labels).toEqual([
			{ key: "good", name: null, sessions: 3 },
			{ key: "bad", name: null, sessions: 2 },
		]);
		expect(picked.compare.a.key).toBe("good");
		expect(picked.compare.b.key).toBe("bad");
		expect(picked.compare.a.sessions).toHaveLength(3);
		expect(picked.compare.b.sessions).toHaveLength(2);
		const rest = await buildSlicesCompare(input, READY, {
			scope: ALL,
			by: "label",
			a: "GOOD",
			b: "",
		});
		expect(rest.compare.a.sessions).toHaveLength(3);
		expect(rest.compare.b.sessions).toHaveLength(6);
		expect(parseCompareParams({ scope: ALL, by: "label", a: "good" }).by).toBe("label");
	});

	test("by filter: the title and first prompt contain a text, against the rest", async () => {
		const { input } = await corpus();
		const result = await buildSlicesCompare(input, READY, {
			scope: ALL,
			by: "filter",
			a: "PARSER",
		});
		expect(result.compare.a.sessions).toHaveLength(4);
		expect(result.compare.b.sessions).toHaveLength(5);
		const empty = await buildSlicesCompare(input, READY, { scope: ALL, by: "filter" });
		expect(empty.compare.a.sessions).toHaveLength(0);
		expect(empty.compare.b.sessions).toHaveLength(0);
		expect(metric(empty, "tokens")?.verdict).toBe("noData");
	});
});
