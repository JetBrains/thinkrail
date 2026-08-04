/** The sync runner's (`git`) options. */
export interface GitRunOptions {
	env?: Record<string, string | undefined>;
	raw?: boolean;
}

/**
 * The full argv for a git invocation. Extracted (and exported) so the flag set is assertable without
 * spawning: `--no-optional-locks` is a **git-level** flag and must sit before the subcommand, alongside
 * `-C` — after the subcommand git rejects it, and a behavioural test on the exit code would pass whether
 * or not the flag were present at all.
 *
 * Unconditional, with no opt-out: every writer this repo has (`init`, `add`, `commit`, `branch`,
 * `worktree add`, …) succeeds under it, because it suppresses only git's *optional* locks, never a required
 * one — so there is no genuinely-write command that needs the flag gone. A pi agent runs git concurrently
 * in this worktree, and a read that refreshes the index as a side effect can lose a race for
 * `.git/index.lock`; a failed read is precisely what this module must never produce.
 */
export function gitArgv(cwd: string, args: string[]): string[] {
	return ["git", "-C", cwd, "--no-optional-locks", ...args];
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
	const result = Bun.spawnSync(gitArgv(cwd, args), {
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
 * The environment a **background** remote operation runs in. It removes every git-level path by which git
 * could stop and ask a human something: terminal prompts, the askpass helpers, and SSH's interactive
 * modes. The operation may then only succeed or fail — it can never hang waiting on input.
 *
 * This is necessary but NOT sufficient: the OS keychain and hardware-backed keys (TouchID, YubiKey) live
 * *below* git and can still surface a prompt. That residue is why `remotes` refuses SSH remotes outright
 * when an external ssh-agent is present, rather than relying on this alone.
 *
 * `GIT_SSH_COMMAND`'s `-o StrictHostKeyChecking=accept-new` is load-bearing, not decoration: `BatchMode=yes`
 * alone fails CLOSED on an unknown host key (batch mode disables the interactive prompt, it does not accept
 * the key), so without `accept-new` the very first background connection to any new host would fail, and
 * this feature would silently never work for that user. Do not simplify this back to bare `BatchMode=yes`.
 */
export const REMOTE_ENV: Record<string, string> = {
	GIT_TERMINAL_PROMPT: "0",
	GIT_ASKPASS: "",
	SSH_ASKPASS: "",
	GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
};

/**
 * Async twin of `git` — runs the command *off* the event loop (`Bun.spawn`, not `spawnSync`), so a slow,
 * network-bound op (e.g. `fetch`) can't freeze the host's single cooperative event loop while it blocks.
 * Use this for anything that may touch the network; `git` (sync) stays for the cheap local plumbing.
 *
 * `opts.timeoutMs` gives a network-bound call a deadline: past it, the child is killed (not merely
 * un-awaited — an orphaned network child would keep its socket and the caller's scheduler slot) and the
 * call resolves a normal `{ ok: false }` failure, never a throw and never a hang. `opts.env` **merges over**
 * `process.env` rather than replacing it — a bare `env` would strip `PATH`/`HOME`/`SSH_AUTH_SOCK`, and git
 * would then fail for reasons unrelated to the caller's intent (e.g. passing `REMOTE_ENV`). Still no `raw`:
 * byte-exact reads stay on the sync runner.
 *
 * When a deadline is set, the child is spawned `detached` (its own session/process group) purely so the
 * deadline can kill the whole **group**, not just the immediate pid: `git`'s http transport forks a
 * `git-remote-http` helper (itself forking again) that inherits the stdout/stderr pipes, and
 * `proc.kill()` alone only signals the top `git` process — verified empirically to leave the helper
 * running, still holding the pipes open, so the read side of this function hung forever even after the
 * "killed" child was gone. Killing `-pid` (the negative pid = the whole group, valid because `detached`
 * makes this child its own group leader) reaps the helper too, which is what lets the stdout/stderr reads
 * below actually see EOF. No deadline, no detach: today's only non-deadlined caller relies on the child
 * staying in the host's own group (e.g. a foreground Ctrl-C during dev), and there is nothing here that
 * would ever kill it anyway.
 */
export async function gitAsync(
	cwd: string,
	args: string[],
	opts: { timeoutMs?: number; env?: Record<string, string | undefined> } = {},
): Promise<{ ok: boolean; out: string; err: string }> {
	const hasDeadline = opts.timeoutMs !== undefined;
	const proc = Bun.spawn(gitArgv(cwd, args), {
		stdout: "pipe",
		stderr: "pipe",
		...(hasDeadline ? { detached: true } : {}),
		...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
	});

	// A network-bound child must not outlive its deadline: kill its whole group, so the socket, any forked
	// transport helper, and the scheduler's slot are all released. `timedOut` is what turns the resulting
	// non-zero exit into an honest message. The kill can race the child's own natural exit (it may finish
	// between the timer firing and the signal landing) — `process.kill` throws `ESRCH` for a group that's
	// already gone, which must not become an uncaught exception in a timer callback.
	let timedOut = false;
	const timer = !hasDeadline
		? null
		: setTimeout(() => {
				timedOut = true;
				try {
					process.kill(-proc.pid, "SIGTERM");
				} catch {
					// Already exited: nothing left to reap.
				}
			}, opts.timeoutMs);

	try {
		const [out, err, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (timedOut) return { ok: false, out: "", err: `timed out after ${opts.timeoutMs}ms` };
		return { ok: exitCode === 0, out: out.trim(), err: err.trim() };
	} finally {
		if (timer) clearTimeout(timer);
	}
}
