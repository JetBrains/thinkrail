/** Run a git command in `cwd`, capturing trimmed stdout/stderr and whether it exited cleanly. */
export function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
	return {
		ok: result.success,
		out: new TextDecoder().decode(result.stdout).trim(),
		err: new TextDecoder().decode(result.stderr).trim(),
	};
}
