import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { REAL_CENTRAL_E2E_ENV } from "./fixtures/centralAgent";
import { holdE2eIdleSleep } from "./idleSleep";
import {
	E2E_ROOT_DIR,
	PARENT_SIGNAL_OWNER_ENV,
	processRunnerInterruption,
	runE2eProcess,
	signalExitCode,
	waitForE2eProcessDrain,
} from "./processRunner";
import {
	E2E_TIMING_PARENT_RUN_ID_ENV,
	type E2eRunTiming,
	isPlaywrightListRun,
	startE2eRunTiming,
} from "./runTiming";
import { parseRunnerArgs, resolveShardCount } from "./shardPlan";

const rootDir = E2E_ROOT_DIR;
const bun = process.execPath;

function elapsed(startedAt: number): string {
	return `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
}

async function run(command: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
	return (await runE2eProcess(command, { env })).exitCode;
}

function playwrightCommand(args: string[]): string[] {
	return [bun, "x", "playwright", "test", ...args];
}

function childEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, THINKRAIL_E2E_SKIP_BUILD: "1" };
	delete env.THINKRAIL_E2E_LANE;
	delete env.PLAYWRIGHT_BLOB_OUTPUT_FILE;
	delete env[REAL_CENTRAL_E2E_ENV];
	delete env[PARENT_SIGNAL_OWNER_ENV];
	delete env[E2E_TIMING_PARENT_RUN_ID_ENV];
	return env;
}

interface LastRun {
	status: "passed" | "failed";
	failedTests: string[];
}

function mergeLastRunFiles(reportDir: string, shardCount: number, failed: boolean): void {
	const failedTests = new Set<string>();
	for (let shard = 1; shard <= shardCount; shard += 1) {
		try {
			const parsed = JSON.parse(
				readFileSync(join(reportDir, `artifacts-${shard}`, ".last-run.json"), "utf8"),
			) as unknown;
			if (parsed !== null && typeof parsed === "object" && "failedTests" in parsed) {
				const ids = parsed.failedTests;
				if (Array.isArray(ids)) {
					for (const id of ids) if (typeof id === "string") failedTests.add(id);
				}
			}
		} catch {}
	}
	const lastRun: LastRun = {
		status: failed ? "failed" : "passed",
		failedTests: [...failedTests],
	};
	const outputDir = join(rootDir, "test-results");
	mkdirSync(outputDir, { recursive: true });
	writeFileSync(join(outputDir, ".last-run.json"), `${JSON.stringify(lastRun, null, 2)}\n`);
}

async function runSerial(playwrightArgs: string[], timing: E2eRunTiming): Promise<number> {
	console.log("E2E: running serially (one host, one worker)");
	return timing.timeShard(1, 1, () => run(playwrightCommand(playwrightArgs), childEnv()));
}

async function runShards(
	shardCount: number,
	playwrightArgs: string[],
	timing: E2eRunTiming,
): Promise<number> {
	const startedAt = performance.now();
	const reportDir = mkdtempSync(join(tmpdir(), "thinkrail-e2e-blobs-"));
	const children: Promise<number>[] = [];

	console.log(`E2E: running ${shardCount} isolated shards (one host and worker each)`);
	for (let shard = 1; shard <= shardCount; shard += 1) {
		const env = {
			...childEnv(),
			THINKRAIL_E2E_LANE: String(shard - 1),
			PLAYWRIGHT_BLOB_OUTPUT_FILE: join(reportDir, `report-${shard}.zip`),
			PWTEST_CACHE_DIR: join(reportDir, `transform-cache-${shard}`),
		};
		const outputDir = join(reportDir, `artifacts-${shard}`);
		const command = playwrightCommand([
			...playwrightArgs,
			`--shard=${shard}/${shardCount}`,
			"--workers=1",
			"--reporter=blob",
			`--output=${outputDir}`,
		]);
		const shardStartedAt = performance.now();
		children.push(
			timing
				.timeShard(shard, shardCount, () => runE2eProcess(command, { env }))
				.then(({ exitCode }) => {
					console.log(
						`E2E: shard ${shard}/${shardCount} ${
							exitCode === 0 ? "passed" : `failed (${exitCode})`
						} in ${elapsed(shardStartedAt)}`,
					);
					return exitCode;
				}),
		);
	}

	const exitCodes = await Promise.all(children);
	const interruption = processRunnerInterruption();
	if (interruption) {
		console.error(`E2E: interrupted; temporary output retained at ${reportDir}`);
		return signalExitCode(interruption);
	}
	const reports = readdirSync(reportDir).filter((name) => name.endsWith(".zip"));
	let mergeCode = 1;
	if (reports.length > 0) {
		const reporters = process.env.CI ? "github,html" : "dot";
		mergeCode = await timing.timePhase("report-merge", () =>
			run([bun, "x", "playwright", "merge-reports", `--reporter=${reporters}`, reportDir]),
		);
	} else {
		console.error(`E2E: no shard reports were produced; temporary output retained at ${reportDir}`);
	}

	const failed = mergeCode !== 0 || exitCodes.some((code) => code !== 0);
	mergeLastRunFiles(reportDir, shardCount, failed);
	if (mergeCode === 0) rmSync(reportDir, { recursive: true, force: true });
	else console.error(`E2E: report merge failed; temporary output retained at ${reportDir}`);
	console.log(
		failed
			? `E2E: one or more shards failed after ${elapsed(startedAt)}`
			: `E2E: all ${shardCount} shards passed in ${elapsed(startedAt)}`,
	);
	return failed ? 1 : 0;
}

async function main(rawArgs: string[], timing: E2eRunTiming): Promise<number> {
	await holdE2eIdleSleep();
	const { playwrightArgs, shardOverride } = parseRunnerArgs(rawArgs);
	const shardCount = resolveShardCount({
		shardOverride,
		envValue: process.env.THINKRAIL_E2E_SHARDS,
		availableCpuCount: availableParallelism(),
		hasPlaywrightArgs: playwrightArgs.length > 0,
	});
	timing.setSelection({ playwrightArgs, shardCount });

	if (!isPlaywrightListRun(playwrightArgs) && process.env.THINKRAIL_E2E_SKIP_BUILD !== "1") {
		const buildStartedAt = performance.now();
		console.log("E2E: building web once before host startup");
		const buildCode = await timing.timeBuild(() => run([bun, "run", "build:web"]));
		if (buildCode !== 0) return buildCode;
		console.log(`E2E: web build ready in ${elapsed(buildStartedAt)}`);
	}

	return shardCount === 1
		? runSerial(playwrightArgs, timing)
		: runShards(shardCount, playwrightArgs, timing);
}

const rawArgs = process.argv.slice(2);
const timing = startE2eRunTiming("no-agent", rawArgs);
let exitCode = 1;
try {
	exitCode = await main(rawArgs, timing);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
}
const interruption = processRunnerInterruption();
if (interruption) await waitForE2eProcessDrain();
timing.finish(exitCode, { interrupted: interruption !== null });
process.exitCode = exitCode;
