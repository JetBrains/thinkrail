/**
 * Run a git command in `cwd`, capturing trimmed stdout/stderr + whether it exited cleanly. Pass `opts.env`
 * to override the child env — Bun's default is a startup snapshot, ignoring later `process.env` mutations.
 */
export function git(
	cwd: string,
	args: string[],
	opts: { env?: Record<string, string | undefined> } = {},
): { ok: boolean; out: string; err: string } {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		// Omit when unset so existing callers keep Bun's inherited default.
		...(opts.env ? { env: opts.env } : {}),
	});
	return {
		ok: result.success,
		out: new TextDecoder().decode(result.stdout).trim(),
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
): Promise<{ ok: boolean; out: string; err: string }> {
	const proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
	const [out, err, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { ok: exitCode === 0, out: out.trim(), err: err.trim() };
}
