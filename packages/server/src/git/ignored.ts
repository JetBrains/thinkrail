import { gitAsync } from "./gitExec";

const TIMEOUT_MS = 10_000;
const PATHS_PER_BATCH = 512;
const MAX_PARALLEL_BATCHES = 4;

export async function ignoredPaths(
	worktreePath: string,
	paths: readonly string[],
): Promise<Set<string>> {
	const ignored = new Set<string>();
	// Give each batch its own deadline without starting a git process for every batch at once.
	for (let start = 0; start < paths.length; start += PATHS_PER_BATCH * MAX_PARALLEL_BATCHES) {
		const runs = [];
		const end = Math.min(start + PATHS_PER_BATCH * MAX_PARALLEL_BATCHES, paths.length);
		for (let i = start; i < end; i += PATHS_PER_BATCH) {
			// check-ignore refuses pathspec magic; a leading ./ makes each worktree path literal.
			const input = paths.slice(i, i + PATHS_PER_BATCH).map((path) => `./${path}\0`);
			runs.push(
				gitAsync(worktreePath, ["check-ignore", "-z", "--stdin"], {
					stdin: new Blob(input),
					timeoutMs: TIMEOUT_MS,
					raw: true,
				}),
			);
		}
		for (const run of await Promise.all(runs)) {
			if (!run.ok) continue;
			for (const path of run.out.split("\0")) {
				if (path) ignored.add(path.slice(2));
			}
		}
	}
	return ignored;
}
