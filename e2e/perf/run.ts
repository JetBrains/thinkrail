import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	E2E_ROOT_DIR,
	processRunnerInterruption,
	runE2eProcess,
	signalExitCode,
} from "../processRunner";
import type { ScenarioRun } from "./render.perf";
import { type ComponentCost, MARKDOWN_SUBTREE } from "./renderProfiler";

const bun = process.execPath;
const DEFAULT_RUNS = 5;
const DEFAULT_OUT = join(tmpdir(), "thinkrail-render-profile.json");
const TABLE_ROWS = 15;

interface RunnerArgs {
	runs: number;
	out: string;
	cpu: number;
	scenarios: string | null;
	playwrightArgs: string[];
}

function parseArgs(argv: string[]): RunnerArgs {
	let runs = DEFAULT_RUNS;
	let out = DEFAULT_OUT;
	let cpu = 1;
	let scenarios: string | null = null;
	const playwrightArgs: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--runs") {
			runs = Number(argv[++index]);
			if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs needs a positive integer");
		} else if (arg === "--out") {
			out = argv[++index] ?? DEFAULT_OUT;
		} else if (arg === "--cpu") {
			cpu = Number(argv[++index]);
			if (!Number.isFinite(cpu) || cpu < 1) throw new Error("--cpu needs a rate >= 1");
		} else if (arg === "--scenario") {
			scenarios = argv[++index] ?? null;
			if (!scenarios) throw new Error("--scenario needs a comma-separated list");
		} else if (arg !== undefined) {
			playwrightArgs.push(arg);
		}
	}
	return { runs, out, cpu, scenarios, playwrightArgs };
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] ?? 0)
		: ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function spreadPct(values: number[]): number {
	const middle = median(values);
	return middle === 0 ? 0 : round(((Math.max(...values) - Math.min(...values)) / middle) * 100);
}

const EMPTY_COST: ComponentCost = {
	commits: 0,
	renders: 0,
	selfTotalMs: 0,
	selfMaxMs: 0,
	inclusiveTotalMs: 0,
	inclusiveMaxMs: 0,
};

function markdownCost(run: ScenarioRun) {
	const tree = run.profile.subtrees[MARKDOWN_SUBTREE];
	const deltas = run.counters.deltas ?? 0;
	const renders = tree?.rootRenders ?? 0;
	const selfMs = tree?.selfTotalMs ?? 0;
	return {
		renders,
		componentRenders: tree?.renders ?? 0,
		selfMs,
		selfMaxMs: tree?.selfMaxMs ?? 0,
		rendersPerDelta: deltas > 0 ? renders / deltas : 0,
		selfMsPerDelta: deltas > 0 ? selfMs / deltas : 0,
	};
}

function medianOf(runs: ScenarioRun[], pick: (run: ScenarioRun) => number): number {
	return round(median(runs.map(pick)));
}

function summarize(runs: ScenarioRun[]) {
	const ordered = [...runs].sort((a, b) => a.run - b.run);
	const totals = ordered.map((run) => run.profile.totalMs);
	const counterNames = new Set(ordered.flatMap((run) => Object.keys(run.counters)));
	const names = new Set(ordered.flatMap((run) => Object.keys(run.profile.components)));
	const components = [...names]
		.map((component) => {
			const costs = ordered.map((run) => run.profile.components[component] ?? EMPTY_COST);
			const selfTotals = costs.map((cost) => cost.selfTotalMs);
			return {
				component,
				medianCommits: median(costs.map((cost) => cost.commits)),
				medianRenders: median(costs.map((cost) => cost.renders)),
				medianSelfTotalMs: round(median(selfTotals)),
				medianSelfMaxMs: round(median(costs.map((cost) => cost.selfMaxMs))),
				medianInclusiveTotalMs: round(median(costs.map((cost) => cost.inclusiveTotalMs))),
				medianInclusiveMaxMs: round(median(costs.map((cost) => cost.inclusiveMaxMs))),
				selfTotalSpreadPct: spreadPct(selfTotals),
			};
		})
		.sort((a, b) => b.medianSelfTotalMs - a.medianSelfTotalMs);
	return {
		runs: ordered.length,
		medianTotalMs: round(median(totals)),
		totalSpreadPct: spreadPct(totals),
		medianCommits: median(ordered.map((run) => run.profile.commits)),
		medianMaxCommitMs: round(median(ordered.map((run) => run.profile.maxCommitMs))),
		medianWallMs: round(median(ordered.map((run) => run.wallMs))),
		counters: Object.fromEntries(
			[...counterNames].map((name) => [name, medianOf(ordered, (run) => run.counters[name] ?? 0)]),
		),
		longTasks: {
			medianCount: medianOf(ordered, (run) => run.profile.longTasks.count),
			medianTotalMs: medianOf(ordered, (run) => run.profile.longTasks.totalMs),
			medianMaxMs: medianOf(ordered, (run) => run.profile.longTasks.maxMs),
		},
		frames: {
			medianP95GapMs: medianOf(ordered, (run) => run.profile.frames.p95GapMs),
			medianMaxGapMs: medianOf(ordered, (run) => run.profile.frames.maxGapMs),
			medianDroppedFrames: medianOf(ordered, (run) => run.profile.frames.droppedFrames),
		},
		mainThread: {
			medianTaskMs: medianOf(ordered, (run) => run.mainThread.taskMs),
			medianScriptMs: medianOf(ordered, (run) => run.mainThread.scriptMs),
			medianLayoutMs: medianOf(ordered, (run) => run.mainThread.layoutMs),
			medianStyleMs: medianOf(ordered, (run) => run.mainThread.styleMs),
			medianHeapDeltaMb: medianOf(ordered, (run) => run.mainThread.heapDeltaMb),
		},
		markdown: {
			medianRenders: medianOf(ordered, (run) => markdownCost(run).renders),
			medianComponentRenders: medianOf(ordered, (run) => markdownCost(run).componentRenders),
			medianSelfMs: medianOf(ordered, (run) => markdownCost(run).selfMs),
			medianSelfMaxMs: medianOf(ordered, (run) => markdownCost(run).selfMaxMs),
			medianRendersPerDelta: medianOf(ordered, (run) => markdownCost(run).rendersPerDelta),
			medianSelfMsPerDelta: medianOf(ordered, (run) => markdownCost(run).selfMsPerDelta),
		},
		perRun: ordered.map((run) => ({
			run: run.run,
			wallMs: round(run.wallMs),
			commits: run.profile.commits,
			totalMs: round(run.profile.totalMs),
			maxCommitMs: round(run.profile.maxCommitMs),
			taskMs: round(run.mainThread.taskMs),
			scriptMs: round(run.mainThread.scriptMs),
			longTaskMs: round(run.profile.longTasks.totalMs),
			p95FrameGapMs: round(run.profile.frames.p95GapMs),
			droppedFrames: run.profile.frames.droppedFrames,
		})),
		components,
	};
}

function printSummary(name: string, summary: ReturnType<typeof summarize>): void {
	console.log(
		`\n${name}: ${summary.runs} runs, median ${summary.medianTotalMs} ms render over ${summary.medianCommits} commits, spread ${summary.totalSpreadPct}%`,
	);
	console.log(
		`  main thread task ${summary.mainThread.medianTaskMs} ms (script ${summary.mainThread.medianScriptMs}, layout ${summary.mainThread.medianLayoutMs}, style ${summary.mainThread.medianStyleMs}), long tasks ${summary.longTasks.medianCount} / ${summary.longTasks.medianTotalMs} ms, frame gap p95 ${summary.frames.medianP95GapMs} ms max ${summary.frames.medianMaxGapMs} ms, dropped ${summary.frames.medianDroppedFrames}, markdown subtree ${summary.markdown.medianRenders} root renders ${summary.markdown.medianSelfMs} ms self (${summary.markdown.medianSelfMsPerDelta} ms/delta, max commit ${summary.markdown.medianSelfMaxMs} ms), counters ${JSON.stringify(summary.counters)}`,
	);
	console.table(
		summary.components.slice(0, TABLE_ROWS).map((row) => ({
			component: row.component,
			commits: row.medianCommits,
			"self ms": row.medianSelfTotalMs,
			"self max ms": row.medianSelfMaxMs,
			"incl ms": row.medianInclusiveTotalMs,
			"spread %": row.selfTotalSpreadPct,
		})),
	);
}

function git(...args: string[]): string | null {
	try {
		return execFileSync("git", ["-C", E2E_ROOT_DIR, ...args], {
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024,
		});
	} catch {
		return null;
	}
}

function gitState() {
	const status = git("status", "--porcelain");
	const diff = git("diff", "HEAD");
	return {
		gitHead: git("rev-parse", "HEAD")?.trim() ?? "unknown",
		dirty: status === null ? null : status.trim().length > 0,
		dirtyTreeHash:
			status === null || diff === null
				? null
				: createHash("sha256").update(status).update(diff).digest("hex").slice(0, 16),
	};
}

async function main(): Promise<number> {
	const { runs, out, cpu, scenarios: selected, playwrightArgs } = parseArgs(process.argv.slice(2));
	console.log("perf: building the profiling web bundle");
	const build = await runE2eProcess([bun, "run", "--cwd", "apps/web", "build:profile"]);
	if (build.exitCode !== 0) return build.exitCode;

	const runDir = mkdtempSync(join(tmpdir(), "thinkrail-perf-runs-"));
	const env = {
		...process.env,
		THINKRAIL_E2E_SKIP_BUILD: "1",
		THINKRAIL_PERF_RUNS: String(runs),
		THINKRAIL_PERF_OUT: runDir,
		THINKRAIL_PERF_CPU: String(cpu),
		...(selected ? { THINKRAIL_PERF_SCENARIOS: selected } : {}),
	};
	const result = await runE2eProcess(
		[bun, "x", "playwright", "test", "-c", "playwright.perf.config.ts", ...playwrightArgs],
		{ env },
	);
	const interruption = processRunnerInterruption();
	if (interruption) return signalExitCode(interruption);

	const runsByScenario = new Map<string, ScenarioRun[]>();
	for (const file of readdirSync(runDir).filter((name) => name.endsWith(".json"))) {
		const run = JSON.parse(readFileSync(join(runDir, file), "utf8")) as ScenarioRun;
		runsByScenario.set(run.scenario, [...(runsByScenario.get(run.scenario) ?? []), run]);
	}
	const scenarios = Object.fromEntries(
		[...runsByScenario].map(([name, scenarioRuns]) => [name, summarize(scenarioRuns)]),
	);
	for (const [name, summary] of Object.entries(scenarios)) printSummary(name, summary);
	writeFileSync(
		out,
		`${JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				rootDir: E2E_ROOT_DIR,
				...gitState(),
				cpuRate: cpu,
				requestedRuns: runs,
				scenarios,
				raw: Object.fromEntries(runsByScenario),
			},
			null,
			2,
		)}\n`,
	);
	rmSync(runDir, { recursive: true, force: true });
	console.log(`\nperf: wrote ${out}`);
	return result.exitCode;
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
