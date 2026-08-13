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

/** Consume runner-only flags and leave every Playwright argument byte-for-byte intact. */
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
