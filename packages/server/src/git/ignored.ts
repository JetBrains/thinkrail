import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gitAsync } from "./gitExec";

const TIMEOUT_MS = 10_000;
const PATHS_PER_RUN = 512;
const PARALLEL_RUNS = 4;

function gitDirOf(worktreePath: string): string | null {
	const dotGit = join(worktreePath, ".git");
	try {
		if (statSync(dotGit).isDirectory()) return dotGit;
		const target = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
		return target ? resolve(worktreePath, target) : null;
	} catch {
		return null;
	}
}

function mayBeSparse(worktreePath: string): boolean {
	const gitDir = gitDirOf(worktreePath);
	return gitDir !== null && existsSync(join(gitDir, "info", "sparse-checkout"));
}

async function checkIgnore(
	worktreePath: string,
	flags: string[],
	paths: readonly string[],
): Promise<string[]> {
	const run = await gitAsync(worktreePath, ["check-ignore", ...flags, "--stdin", "-z"], {
		timeoutMs: TIMEOUT_MS,
		raw: true,
		stdin: new Blob(paths.map((path) => `./${path}\0`)),
	});
	return run.out
		.split("\0")
		.filter((path) => path.startsWith("./"))
		.map((path) => path.slice(2));
}

export async function ignoredPaths(
	worktreePath: string,
	paths: readonly string[],
): Promise<Set<string>> {
	const ignored = new Set<string>();
	if (paths.length === 0) return ignored;
	const matched = mayBeSparse(worktreePath)
		? paths
		: await checkIgnore(worktreePath, ["--no-index"], paths);
	const batches: (readonly string[])[] = [];
	for (let at = 0; at < matched.length; at += PATHS_PER_RUN)
		batches.push(matched.slice(at, at + PATHS_PER_RUN));
	for (let at = 0; at < batches.length; at += PARALLEL_RUNS) {
		const runs = batches
			.slice(at, at + PARALLEL_RUNS)
			.map((batch) => checkIgnore(worktreePath, [], batch));
		for (const found of await Promise.all(runs)) for (const path of found) ignored.add(path);
	}
	return ignored;
}
