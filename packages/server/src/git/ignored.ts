import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gitAsync } from "./gitExec";

const MAX_ARGS_CHARS = 24_000;
const TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();

function argChunks(paths: readonly string[]): string[][] {
	const chunks: string[][] = [];
	let current: string[] = [];
	let length = 0;
	for (const path of paths) {
		if (current.length > 0 && length + path.length + 1 > MAX_ARGS_CHARS) {
			chunks.push(current);
			current = [];
			length = 0;
		}
		current.push(path);
		length += path.length + 1;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

const withDotSlash = (path: string) => `./${path}`;
const withoutDotSlash = (lines: string[]) =>
	lines.filter((line) => line.startsWith("./")).map((line) => line.slice(2));

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

async function matchingAnyRule(worktreePath: string, paths: readonly string[]): Promise<string[]> {
	if (paths.length === 0) return [];
	const run = await gitAsync(worktreePath, ["check-ignore", "--no-index", "--stdin", "-z"], {
		timeoutMs: TIMEOUT_MS,
		raw: true,
		stdin: encoder.encode(paths.map((path) => `${withDotSlash(path)}\0`).join("")),
	});
	return run.ok ? withoutDotSlash(run.out.split("\0")) : [];
}

export async function ignoredPaths(
	worktreePath: string,
	paths: readonly string[],
): Promise<Set<string>> {
	const matched = mayBeSparse(worktreePath) ? paths : await matchingAnyRule(worktreePath, paths);
	const runs = await Promise.all(
		argChunks(matched.map(withDotSlash)).map((chunk) =>
			gitAsync(worktreePath, ["-c", "core.quotePath=false", "check-ignore", "--", ...chunk], {
				timeoutMs: TIMEOUT_MS,
				raw: true,
			}),
		),
	);
	const ignored = new Set<string>();
	for (const run of runs) {
		if (!run.ok) continue;
		const lines = run.out.split("\n").map((raw) => (raw.endsWith("\r") ? raw.slice(0, -1) : raw));
		for (const path of withoutDotSlash(lines)) ignored.add(path);
	}
	return ignored;
}
