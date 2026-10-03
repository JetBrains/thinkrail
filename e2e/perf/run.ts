import { execFileSync } from "node:child_process";
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
import type { ComponentCost } from "./renderProfiler";

const bun = process.execPath;
const DEFAULT_RUNS = 5;
const DEFAULT_OUT = join(tmpdir(), "thinkrail-render-profile.json");
const TABLE_ROWS = 15;

interface RunnerArgs {
	runs: number;
	out: string;
	playwrightArgs: string[];
}

function parseArgs(argv: string[]): RunnerArgs {
	let runs = DEFAULT_RUNS;
	let out = DEFAULT_OUT;
	const playwrightArgs: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--runs") {
			runs = Number(argv[++index]);
			if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs needs a positive integer");
		} else if (arg === "--out") {
			out = argv[++index] ?? DEFAULT_OUT;
		} else if (arg !== undefined) {
			playwrightArgs.push(arg);
		}
	}
	return { runs, out, playwrightArgs };
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

function summarize(runs: ScenarioRun[]) {
	const ordered = [...runs].sort((a, b) => a.run - b.run);
	const totals = ordered.map((run) => run.profile.totalMs);
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
		perRun: ordered.map((run) => ({
			run: run.run,
			wallMs: round(run.wallMs),
			commits: run.profile.commits,
			totalMs: round(run.profile.totalMs),
			maxCommitMs: round(run.profile.maxCommitMs),
		})),
		components,
	};
}

function printSummary(name: string, summary: ReturnType<typeof summarize>): void {
	console.log(
		`\n${name}: ${summary.runs} runs, median ${summary.medianTotalMs} ms render over ${summary.medianCommits} commits, spread ${summary.totalSpreadPct}%`,
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

function gitHead(): string {
	try {
		return execFileSync("git", ["-C", E2E_ROOT_DIR, "rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim();
	} catch {
		return "unknown";
	}
}

async function main(): Promise<number> {
	const { runs, out, playwrightArgs } = parseArgs(process.argv.slice(2));
	console.log("perf: building the profiling web bundle");
	const build = await runE2eProcess([bun, "run", "--cwd", "apps/web", "build:profile"]);
	if (build.exitCode !== 0) return build.exitCode;

	const runDir = mkdtempSync(join(tmpdir(), "thinkrail-perf-runs-"));
	const env = {
		...process.env,
		THINKRAIL_E2E_SKIP_BUILD: "1",
		THINKRAIL_PERF_RUNS: String(runs),
		THINKRAIL_PERF_OUT: runDir,
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
				gitHead: gitHead(),
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
