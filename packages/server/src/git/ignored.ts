import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gitAsync } from "./gitExec";

const TIMEOUT_MS = 10_000;
const PATHS_PER_RUN = 512;
const MAX_ARGS_CHARS = 24_000;
const PARALLEL_RUNS = 4;
const C_ESCAPES: Readonly<Record<string, number>> = {
	a: 7,
	b: 8,
	t: 9,
	n: 10,
	v: 11,
	f: 12,
	r: 13,
	'"': 34,
	"\\": 92,
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
	const run = await gitAsync(worktreePath, ["check-ignore", "--no-index", "--stdin", "-z"], {
		timeoutMs: TIMEOUT_MS,
		raw: true,
		stdin: new Blob(paths.map((path) => `./${path}\0`)),
	});
	return run.out
		.split("\0")
		.filter((path) => path.startsWith("./"))
		.map((path) => path.slice(2));
}

function unquoteGitPath(line: string): string {
	if (line.length < 2 || !line.startsWith('"') || !line.endsWith('"')) return line;
	const body = line.slice(1, -1);
	const bytes: number[] = [];
	let at = 0;
	while (at < body.length) {
		const slash = body.indexOf("\\", at);
		bytes.push(...encoder.encode(body.slice(at, slash === -1 ? body.length : slash)));
		if (slash === -1) break;
		const octal = /^[0-3][0-7]{2}/.exec(body.slice(slash + 1, slash + 4))?.[0];
		if (octal) {
			bytes.push(Number.parseInt(octal, 8));
			at = slash + 4;
		} else {
			const escaped = body[slash + 1] ?? "\\";
			bytes.push(C_ESCAPES[escaped] ?? escaped.charCodeAt(0));
			at = slash + 2;
		}
	}
	return decoder.decode(new Uint8Array(bytes));
}

function argBatches(paths: readonly string[]): string[][] {
	const batches: string[][] = [];
	let current: string[] = [];
	let length = 0;
	for (const path of paths) {
		const arg = `./${path}`;
		if (
			current.length === PATHS_PER_RUN ||
			(current.length > 0 && length + arg.length + 1 > MAX_ARGS_CHARS)
		) {
			batches.push(current);
			current = [];
			length = 0;
		}
		current.push(arg);
		length += arg.length + 1;
	}
	if (current.length > 0) batches.push(current);
	return batches;
}

async function ignoredByIndex(worktreePath: string, args: readonly string[]): Promise<string[]> {
	const run = await gitAsync(
		worktreePath,
		["-c", "core.quotePath=false", "check-ignore", "--", ...args],
		{
			timeoutMs: TIMEOUT_MS,
			raw: true,
		},
	);
	return run.out
		.split("\n")
		.map((line) => unquoteGitPath(line.endsWith("\r") ? line.slice(0, -1) : line))
		.filter((path) => path.startsWith("./"))
		.map((path) => path.slice(2));
}

export async function ignoredPaths(
	worktreePath: string,
	paths: readonly string[],
): Promise<Set<string>> {
	const ignored = new Set<string>();
	if (paths.length === 0) return ignored;
	const matched = mayBeSparse(worktreePath) ? paths : await matchingAnyRule(worktreePath, paths);
	const batches = argBatches(matched);
	for (let at = 0; at < batches.length; at += PARALLEL_RUNS) {
		const runs = batches
			.slice(at, at + PARALLEL_RUNS)
			.map((batch) => ignoredByIndex(worktreePath, batch));
		for (const found of await Promise.all(runs)) for (const path of found) ignored.add(path);
	}
	return ignored;
}
