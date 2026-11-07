import { gitAsync } from "./gitExec";

const TIMEOUT_MS = 10_000;

export async function ignoredPaths(
	worktreePath: string,
	paths: readonly string[],
): Promise<Set<string>> {
	if (paths.length === 0) return new Set();
	// check-ignore refuses pathspec magic; a leading ./ makes each worktree path literal.
	const input = paths.map((path) => `./${path}\0`);
	const run = await gitAsync(worktreePath, ["check-ignore", "-z", "--stdin"], {
		stdin: new Blob(input),
		timeoutMs: TIMEOUT_MS,
		raw: true,
	});
	return new Set(run.ok ? run.out.split("\0").filter(Boolean).map((path) => path.slice(2)) : []);
}
