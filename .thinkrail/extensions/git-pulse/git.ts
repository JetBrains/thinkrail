import { type ExecFileException, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { type FetchResult, MAX_COMMITS, type Pulse } from "./model";
import { LOG_FORMAT, parseLog, parseStatus } from "./parse";

const READ_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 8 * 1024 * 1024;

const ENV = {
	...process.env,
	GIT_TERMINAL_PROMPT: "0",
	GIT_OPTIONAL_LOCKS: "0",
	LC_ALL: "C",
};

interface GitRun {
	ok: boolean;
	stdout: string;
	stderr: string;
}

const failureOf = (
	error: ExecFileException,
	command: string,
	timeout: number,
	signal: AbortSignal,
) => {
	if (signal.aborted) return `${command} cancelled`;
	if (error.killed) return `${command} timed out after ${timeout / 1000}s`;
	return typeof error.code === "string" ? error.message : "";
};

interface GitOptions {
	signal: AbortSignal;
	timeout?: number;
}

const git = (cwd: string, args: readonly string[], options: GitOptions) =>
	new Promise<GitRun>((resolve) => {
		const { signal, timeout = READ_TIMEOUT_MS } = options;
		execFile(
			"git",
			["--no-optional-locks", ...args],
			{ cwd, env: ENV, timeout, signal, maxBuffer: MAX_BUFFER, encoding: "utf8" },
			(error, stdout, stderr) => {
				const failure = error ? failureOf(error, `git ${args[0]}`, timeout, signal) : "";
				resolve({
					ok: !error,
					stdout,
					stderr: [stderr.trim(), failure].filter(Boolean).join("\n"),
				});
			},
		);
	});

const NOT_GIT = /not a git repository/i;

export const gitDirOf = async (path: string, signal: AbortSignal) => {
	const run = await git(path, ["rev-parse", "--absolute-git-dir"], { signal });
	if (run.ok) return { gitDir: run.stdout.trim() };
	return NOT_GIT.test(run.stderr)
		? { notGit: true as const }
		: { error: run.stderr.trim() || "git rev-parse failed" };
};

export const readPulse = async (path: string, signal: AbortSignal): Promise<Pulse> => {
	if (!existsSync(path)) return { state: "error", path, message: `${path} does not exist.` };
	const status = await git(path, ["status", "--porcelain=v2", "--branch", "--show-stash", "-z"], {
		signal,
	});
	if (!status.ok) {
		if (NOT_GIT.test(status.stderr)) return { state: "not-git", path };
		return { state: "error", path, message: status.stderr.trim() || "git status failed" };
	}
	const snapshot = parseStatus(status.stdout);
	if (snapshot.head.kind === "unborn") return { state: "ready", path, ...snapshot, commits: [] };
	const log = await git(path, ["log", `-n${MAX_COMMITS}`, `--format=${LOG_FORMAT}`, "HEAD"], {
		signal,
	});
	return { state: "ready", path, ...snapshot, commits: log.ok ? parseLog(log.stdout) : [] };
};

export const fetchRemotes = async (path: string, signal: AbortSignal): Promise<FetchResult> => {
	const run = await git(path, ["fetch", "--all", "--no-auto-maintenance"], {
		signal,
		timeout: FETCH_TIMEOUT_MS,
	});
	const output = [run.stdout, run.stderr]
		.map((text) => text.trim())
		.filter(Boolean)
		.join("\n");
	return {
		ok: run.ok,
		output: output || (run.ok ? "Already up to date." : "git fetch failed"),
		at: Date.now(),
	};
};
