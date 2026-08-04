/** The sync runner's (`git`) options. `gitAsync` implements only `optionalLocks` — see its signature. */
export interface GitRunOptions {
	env?: Record<string, string | undefined>;
	raw?: boolean;
	/**
	 * Allow git's *optional* locks (default: no). A pi agent runs git concurrently in this worktree, so a
	 * read that refreshes the index as a side effect can lose a race for `.git/index.lock` — and a failed
	 * read is precisely what this module must never produce. Set this only for a command that must
	 * genuinely write.
	 */
	optionalLocks?: boolean;
}

/**
 * The full argv for a git invocation. Extracted (and exported) so the flag set is assertable without
 * spawning: `--no-optional-locks` is a **git-level** flag and must sit before the subcommand, alongside
 * `-C` — after the subcommand git rejects it, and a behavioural test on the exit code would pass whether
 * or not the flag were present at all.
 */
export function gitArgv(cwd: string, args: string[], opts: GitRunOptions = {}): string[] {
	return ["git", "-C", cwd, ...(opts.optionalLocks ? [] : ["--no-optional-locks"]), ...args];
}

/**
 * Run a git command in `cwd`, capturing trimmed stdout/stderr + whether it exited cleanly. Pass `opts.env`
 * to override the child env — Bun's default is a startup snapshot, ignoring later `process.env` mutations.
 * Pass `opts.raw` to keep stdout byte-exact (file *content* reads — e.g. `git show ref:path` — must not
 * lose leading/trailing whitespace to the trim).
 */
export function git(
	cwd: string,
	args: string[],
	opts: GitRunOptions = {},
): { ok: boolean; out: string; err: string } {
	const result = Bun.spawnSync(gitArgv(cwd, args, opts), {
		stdout: "pipe",
		stderr: "pipe",
		// Omit when unset so existing callers keep Bun's inherited default.
		...(opts.env ? { env: opts.env } : {}),
	});
	const stdout = new TextDecoder().decode(result.stdout);
	return {
		ok: result.success,
		out: opts.raw ? stdout : stdout.trim(),
		err: new TextDecoder().decode(result.stderr).trim(),
	};
}

/**
 * Async twin of `git` — runs the command *off* the event loop (`Bun.spawn`, not `spawnSync`), so a slow,
 * network-bound op (e.g. `fetch`) can't freeze the host's single cooperative event loop while it blocks.
 * Use this for anything that may touch the network; `git` (sync) stays for the cheap local plumbing.
 */
export async function gitAsync(
	cwd: string,
	args: string[],
	// `optionalLocks` only: `gitAsync` does not implement `env` or `raw`, and accepting them in the type
	// would let a future caller pass one and silently get trimmed output or an un-overridden env.
	opts: Pick<GitRunOptions, "optionalLocks"> = {},
): Promise<{ ok: boolean; out: string; err: string }> {
	const proc = Bun.spawn(gitArgv(cwd, args, opts), { stdout: "pipe", stderr: "pipe" });
	const [out, err, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { ok: exitCode === 0, out: out.trim(), err: err.trim() };
}
