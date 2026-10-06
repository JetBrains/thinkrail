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

	const remaining = [...args];
	for (let arg = remaining.shift(); arg !== undefined; arg = remaining.shift()) {
		if (arg === "--serial") {
			setOverride(1, "--serial");
			continue;
		}
		if (arg === "--shards") {
			const value = remaining.shift();
			if (value === undefined) throw new Error("--shards requires a value");
			setOverride(parseShardCount(value, "--shards"), "--shards");
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

export function laneShardArgs(
	job: JobShard | undefined,
	lane: number,
	laneCount: number,
): string[] {
	const index = job ? (job.index - 1) * laneCount + lane : lane;
	const total = (job?.total ?? 1) * laneCount;
	return total === 1 ? [] : [`--shard=${index}/${total}`];
}
