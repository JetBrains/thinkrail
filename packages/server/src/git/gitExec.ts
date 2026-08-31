import { runBounded } from "../subprocess";

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
	failure?: "timeout" | "launch";
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
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: nonInteractiveGitEnv(),
	});
	const stdout = new TextDecoder().decode(result.stdout);
	return {
		ok: result.success,
		out: opts.raw ? stdout : stdout.trim(),
		err: boundedStderr(new TextDecoder().decode(result.stderr)),
	};
}

export async function gitAsync(
	cwd: string,
	args: string[],
	opts: {
		raw?: boolean;
		timeoutMs?: number;
		env?: Record<string, string | undefined>;
		network?: boolean;
	} = {},
): Promise<GitResult> {
	const run = await runBounded(["git", "-C", cwd, ...args], {
		timeoutMs: opts.timeoutMs ?? NETWORK_TIMEOUT_MS,
		env: opts.env ?? nonInteractiveGitEnv(),
	});
	if (run.timedOut) {
		const captured = boundedStderr(run.err);
		const noAnswer = opts.network ? NETWORK_NO_ANSWER : LOCAL_NO_ANSWER;
		return {
			ok: false,
			out: "",
			err: `${STALLED(run.waitedMs)} — ${captured || noAnswer}`,
			failure: "timeout",
		};
	}
	return {
		ok: run.ok,
		out: opts.raw ? run.out : run.out.trim(),
		err: boundedStderr(run.err),
		...(run.launchFailed && { failure: "launch" as const }),
	};
}
