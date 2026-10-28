import { spawnSyncCaptured, spawnSyncCapturedBytes } from "@thinkrail/shared/spawn";
import { type BoundedStream, runBounded, streamBounded } from "../subprocess";

const NETWORK_TIMEOUT_MS = 55_000;
const MAX_STDERR_CHARS = 2_000;
const TRUNCATION_MARK = "… (truncated) …";
const HEAD_CHARS = 1_200;
const TAIL_CHARS = MAX_STDERR_CHARS - TRUNCATION_MARK.length - HEAD_CHARS;

const STALLED = (waitedMs: number) =>
	`timed out after ${Math.max(1, Math.round(waitedMs / 1000))}s`;
const LOCAL_NO_ANSWER = "git did not exit";
const NETWORK_NO_ANSWER =
	"the remote never answered; if it uses SSH, a key that is not loaded is the usual cause (`ssh-add`)";

export type GitResult = {
	ok: boolean;
	out: string;
	err: string;
	failure?: "timeout" | "launch" | "aborted";
};

export type GitBytesResult = {
	ok: boolean;
	out: Uint8Array;
	err: string;
};

export type GitAsyncBytesResult = GitBytesResult & Pick<GitResult, "failure">;

type GitAsyncOptions = {
	timeoutMs?: number;
	env?: Record<string, string | undefined>;
	network?: boolean;
	signal?: AbortSignal;
};

export function nonInteractiveGitEnv(): Record<string, string | undefined> {
	return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}

function boundedStderr(raw: string): string {
	const err = raw.trim();
	if (err.length <= MAX_STDERR_CHARS) return err;
	const head = err.slice(0, HEAD_CHARS);
	const tail = err.slice(err.length - TAIL_CHARS);
	return `${head}${TRUNCATION_MARK}${tail}`;
}

export function git(cwd: string, args: string[], opts: { raw?: boolean } = {}): GitResult {
	const result = spawnSyncCaptured(["git", "-C", cwd, ...args], {
		env: nonInteractiveGitEnv(),
		maxBuffer: Number.POSITIVE_INFINITY,
	});
	return {
		ok: result.launched && result.exitCode === 0,
		out: opts.raw ? result.stdout : result.stdout.trim(),
		err: boundedStderr(result.stderr),
	};
}

export function gitBytes(
	cwd: string,
	args: string[],
	opts: { env?: Record<string, string | undefined> } = {},
): GitBytesResult {
	const result = spawnSyncCapturedBytes(["git", "-C", cwd, ...args], {
		env: opts.env ?? nonInteractiveGitEnv(),
		maxBuffer: Number.POSITIVE_INFINITY,
	});
	return {
		ok: result.launched && result.exitCode === 0,
		out: result.stdout,
		err: boundedStderr(result.stderr),
	};
}

function timeoutFailure(
	run: { err: string; waitedMs: number },
	network: boolean | undefined,
): { err: string; failure: "timeout" } {
	const captured = boundedStderr(run.err);
	const noAnswer = network ? NETWORK_NO_ANSWER : LOCAL_NO_ANSWER;
	return {
		err: `${STALLED(run.waitedMs)} — ${captured || noAnswer}`,
		failure: "timeout",
	};
}

function executionDiagnostics(run: {
	err: string;
	aborted?: true;
	launchFailed: boolean;
}): Pick<GitResult, "err" | "failure"> {
	const err = boundedStderr(run.err);
	if (run.aborted) {
		return { err: `git operation cancelled${err ? ` — ${err}` : ""}`, failure: "aborted" };
	}
	return { err, ...(run.launchFailed && { failure: "launch" as const }) };
}

export async function gitAsync(
	cwd: string,
	args: string[],
	opts: GitAsyncOptions & { raw?: boolean } = {},
): Promise<GitResult> {
	const run = await runBounded(["git", "-C", cwd, ...args], {
		timeoutMs: opts.timeoutMs ?? NETWORK_TIMEOUT_MS,
		env: opts.env ?? nonInteractiveGitEnv(),
		...(opts.signal ? { signal: opts.signal } : {}),
	});
	if (run.timedOut) {
		return { ok: false, out: "", ...timeoutFailure(run, opts.network) };
	}
	return {
		ok: run.ok,
		out: opts.raw ? run.out : run.out.trim(),
		...executionDiagnostics(run),
	};
}

export function gitAsyncStream(
	cwd: string,
	args: string[],
	opts: Omit<GitAsyncOptions, "signal"> = {},
): BoundedStream {
	return streamBounded(["git", "-C", cwd, ...args], {
		timeoutMs: opts.timeoutMs ?? NETWORK_TIMEOUT_MS,
		env: opts.env ?? nonInteractiveGitEnv(),
	});
}

export async function gitAsyncBytes(
	cwd: string,
	args: string[],
	opts: GitAsyncOptions = {},
): Promise<GitAsyncBytesResult> {
	const run = await runBounded(["git", "-C", cwd, ...args], {
		timeoutMs: opts.timeoutMs ?? NETWORK_TIMEOUT_MS,
		env: opts.env ?? nonInteractiveGitEnv(),
		stdout: "bytes",
		...(opts.signal ? { signal: opts.signal } : {}),
	});
	if (run.timedOut) {
		return { ok: false, out: new Uint8Array(), ...timeoutFailure(run, opts.network) };
	}
	return {
		ok: run.ok,
		out: run.out,
		...executionDiagnostics(run),
	};
}
