export const AUTO_E2E_SHARD_CAP = 8;
export const MAX_E2E_SHARDS = 16;

export interface RunnerArgs {
	playwrightArgs: string[];
	shardOverride?: number;
}

function parseShardCount(raw: string, source: string): number {
	const count = Number(raw);
	if (!Number.isInteger(count) || count < 1 || count > MAX_E2E_SHARDS) {
		throw new Error(
			`${source} must be an integer in [1, ${MAX_E2E_SHARDS}], got ${JSON.stringify(raw)}`,
		);
	}
	return count;
}

export function parseRunnerArgs(args: readonly string[]): RunnerArgs {
	const playwrightArgs: string[] = [];
	let shardOverride: number | undefined;
	const setOverride = (count: number, source: string) => {
		if (shardOverride !== undefined) {
			throw new Error(`shard count was specified more than once (${source})`);
		}
		shardOverride = count;
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--serial") {
			setOverride(1, "--serial");
			continue;
		}
		if (arg === "--shards") {
			const value = args[index + 1];
			if (value === undefined) throw new Error("--shards requires a value");
			setOverride(parseShardCount(value, "--shards"), "--shards");
			index += 1;
			continue;
		}
		if (arg.startsWith("--shards=")) {
			setOverride(parseShardCount(arg.slice("--shards=".length), "--shards"), "--shards");
			continue;
		}
		playwrightArgs.push(arg);
	}
	return shardOverride === undefined ? { playwrightArgs } : { playwrightArgs, shardOverride };
}

export function automaticShardCount(availableCpuCount: number): number {
	if (!Number.isFinite(availableCpuCount) || availableCpuCount < 1) return 1;
	return Math.max(1, Math.min(AUTO_E2E_SHARD_CAP, Math.floor(availableCpuCount / 2)));
}

export function resolveShardCount(options: {
	shardOverride?: number;
	envValue?: string;
	availableCpuCount: number;
	hasPlaywrightArgs: boolean;
}): number {
	if (options.shardOverride !== undefined) return options.shardOverride;
	if (options.envValue !== undefined && options.envValue !== "") {
		return parseShardCount(options.envValue, "THINKRAIL_E2E_SHARDS");
	}
	if (options.hasPlaywrightArgs) return 1;
	return automaticShardCount(options.availableCpuCount);
}

export interface JobShard {
	index: number;
	total: number;
}

export function parseJobShard(raw: string | undefined): JobShard | undefined {
	if (raw === undefined || raw === "") return undefined;
	const match = /^(\d+)\/(\d+)$/.exec(raw);
	const index = Number(match?.[1]);
	const total = Number(match?.[2]);
	if (!match || total < 1 || index < 1 || index > total) {
		throw new Error(
			`THINKRAIL_E2E_JOB_SHARD must be "k/N" with 1 <= k <= N, got ${JSON.stringify(raw)}`,
		);
	}
	return { index, total };
}

export interface LaneShard {
	job: JobShard | undefined;
	lane: number;
	laneCount: number;
}

export function laneShard(
	job: JobShard | undefined,
	lane: number,
	laneCount: number,
): LaneShard | undefined {
	return job || laneCount > 1 ? { job, lane, laneCount } : undefined;
}

export function isShardArg(arg: string): boolean {
	return arg === "--shard" || arg.startsWith("--shard=");
}

export interface ListedTest {
	file: string;
	titles: string[];
}

const TEST_LIST_DELIMITER = "\u203A";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
	return value !== null && typeof value === "object" ? (value as JsonRecord) : null;
}

function collectSuiteTests(value: unknown, file: string, parents: string[], tests: ListedTest[]) {
	const suite = record(value);
	if (!suite) return;
	if (Array.isArray(suite.specs)) {
		for (const value of suite.specs) {
			const spec = record(value);
			if (spec && typeof spec.title === "string") {
				const titles = [...parents, spec.title];
				if (spec.file !== file) {
					throw new Error(
						`${file}: test ${JSON.stringify(titles.join(" > "))} is declared in ${String(spec.file)}; a Playwright test list cannot select it`,
					);
				}
				tests.push({ file, titles });
			}
		}
	}
	if (Array.isArray(suite.suites)) {
		for (const child of suite.suites) {
			const title = record(child)?.title;
			if (typeof title === "string") {
				collectSuiteTests(child, file, title === "" ? parents : [...parents, title], tests);
			}
		}
	}
}

function startsWithTitles(titles: readonly string[], prefix: readonly string[]): boolean {
	return prefix.length <= titles.length && prefix.every((title, index) => titles[index] === title);
}

function assertAddressable(tests: readonly ListedTest[]): void {
	const byFile = new Map<string, ListedTest[]>();
	for (const test of tests) byFile.set(test.file, [...(byFile.get(test.file) ?? []), test]);
	for (const [file, fileTests] of byFile) {
		for (const test of fileTests) {
			const bad = test.titles.find(
				(title) =>
					title === "" ||
					title !== title.trim() ||
					/[\r\n]/.test(title) ||
					title.includes(TEST_LIST_DELIMITER),
			);
			if (bad !== undefined) {
				throw new Error(
					`${file}: title ${JSON.stringify(bad)} cannot be addressed by a Playwright test list`,
				);
			}
			const clash = fileTests.find(
				(other) => other !== test && startsWithTitles(other.titles, test.titles),
			);
			if (clash) {
				throw new Error(
					`${file}: test ${JSON.stringify(test.titles.join(" > "))} also selects ${JSON.stringify(clash.titles.join(" > "))}; give it a unique title`,
				);
			}
		}
	}
}

export function listedPlaywrightTests(output: string): ListedTest[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		throw new Error("Playwright shard listing did not return JSON");
	}
	const report = record(parsed);
	if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors)) {
		throw new Error("Playwright shard listing returned an invalid report");
	}
	if (report.errors.length > 0) {
		const message = record(report.errors[0])?.message;
		throw new Error(
			typeof message === "string"
				? `Playwright shard listing failed: ${message}`
				: "Playwright shard listing failed",
		);
	}
	const listed: ListedTest[] = [];
	for (const value of report.suites) {
		const file = record(value)?.file;
		if (typeof file === "string") collectSuiteTests(value, file, [], listed);
	}
	const seen = new Set<string>();
	const tests = listed.filter((test) => {
		const key = JSON.stringify([test.file, ...test.titles]);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	assertAddressable(tests);
	return tests;
}

function dealt<T>(items: readonly T[], index: number, total: number): T[] {
	return items.filter((_, position) => position % total === index - 1);
}

export function interleavedTestList(tests: readonly ListedTest[], shard: LaneShard): string {
	const slice = shard.job ? dealt(tests, shard.job.index, shard.job.total) : tests;
	return dealt(slice, shard.lane, shard.laneCount)
		.map((test) => `${[test.file, ...test.titles].join(` ${TEST_LIST_DELIMITER} `)}\n`)
		.join("");
}
