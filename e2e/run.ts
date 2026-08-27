import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRunnerArgs, resolveShardCount } from "./shardPlan";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const bun = process.execPath;

function elapsed(startedAt: number): string {
	return `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
}

async function run(command: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
	const child = Bun.spawn(command, {
		cwd: rootDir,
		env,
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	return child.exited;
}

function playwrightCommand(args: string[]): string[] {
	return [bun, "x", "playwright", "test", "--grep-invert", "@agent", ...args];
}

function childEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, THINKRAIL_E2E_SKIP_BUILD: "1" };
	delete env.THINKRAIL_E2E_LANE;
	delete env.PLAYWRIGHT_BLOB_OUTPUT_FILE;
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

async function runSerial(playwrightArgs: string[]): Promise<number> {
	console.log("E2E: running serially (one host, one worker)");
	return run(playwrightCommand(playwrightArgs), childEnv());
}

async function runShards(shardCount: number, playwrightArgs: string[]): Promise<number> {
	const startedAt = performance.now();
	const reportDir = mkdtempSync(join(tmpdir(), "thinkrail-e2e-blobs-"));
	const children: ReturnType<typeof Bun.spawn>[] = [];
	let interrupted = false;
	const stopChildren = () => {
		interrupted = true;
		for (const child of children) child.kill();
	};
	process.once("SIGINT", stopChildren);
	process.once("SIGTERM", stopChildren);

	console.log(`E2E: running ${shardCount} isolated shards (one host and worker each)`);
	const shardStarts = new Map<number, number>();
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
		shardStarts.set(shard, performance.now());
		children.push(
			Bun.spawn(command, {
				cwd: rootDir,
				env,
				stdin: "ignore",
				stdout: "inherit",
				stderr: "inherit",
			}),
		);
	}

	const exitCodes = await Promise.all(
		children.map(async (child, index) => {
			const code = await child.exited;
			const shard = index + 1;
			const startedAt = shardStarts.get(shard);
			console.log(
				`E2E: shard ${shard}/${shardCount} ${code === 0 ? "passed" : `failed (${code})`} in ${
					startedAt === undefined ? "unknown time" : elapsed(startedAt)
				}`,
			);
			return code;
		}),
	);

	process.off("SIGINT", stopChildren);
	process.off("SIGTERM", stopChildren);
	const reports = readdirSync(reportDir).filter((name) => name.endsWith(".zip"));
	let mergeCode = 1;
	if (reports.length > 0) {
		const reporters = process.env.CI ? "github,html" : "dot";
		mergeCode = await run([
			bun,
			"x",
			"playwright",
			"merge-reports",
			`--reporter=${reporters}`,
			reportDir,
		]);
	} else {
		console.error(`E2E: no shard reports were produced; temporary output retained at ${reportDir}`);
	}

	const failed = interrupted || mergeCode !== 0 || exitCodes.some((code) => code !== 0);
	mergeLastRunFiles(reportDir, shardCount, failed);
	if (mergeCode === 0) rmSync(reportDir, { recursive: true, force: true });
	else console.error(`E2E: report merge failed; temporary output retained at ${reportDir}`);
	if (interrupted) return 130;
	console.log(
		failed
			? `E2E: one or more shards failed after ${elapsed(startedAt)}`
			: `E2E: all ${shardCount} shards passed in ${elapsed(startedAt)}`,
	);
	return failed ? 1 : 0;
}

async function main(): Promise<number> {
	const { playwrightArgs, shardOverride } = parseRunnerArgs(process.argv.slice(2));
	const shardCount = resolveShardCount({
		shardOverride,
		envValue: process.env.THINKRAIL_E2E_SHARDS,
		availableCpuCount: availableParallelism(),
		hasPlaywrightArgs: playwrightArgs.length > 0,
	});

	if (!playwrightArgs.includes("--list")) {
		const buildStartedAt = performance.now();
		console.log("E2E: building web once before host startup");
		const buildCode = await run([bun, "run", "build:web"]);
		if (buildCode !== 0) return buildCode;
		console.log(`E2E: web build ready in ${elapsed(buildStartedAt)}`);
	}

	return shardCount === 1 ? runSerial(playwrightArgs) : runShards(shardCount, playwrightArgs);
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
