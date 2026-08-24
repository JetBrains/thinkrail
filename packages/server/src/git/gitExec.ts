export function git(
	cwd: string,
	args: string[],
	opts: { env?: Record<string, string | undefined>; raw?: boolean } = {},
): { ok: boolean; out: string; err: string } {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		...(opts.env ? { env: opts.env } : {}),
	});
	const stdout = new TextDecoder().decode(result.stdout);
	return {
		ok: result.success,
		out: opts.raw ? stdout : stdout.trim(),
		err: new TextDecoder().decode(result.stderr).trim(),
	};
}

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
