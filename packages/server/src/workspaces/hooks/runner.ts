// Spawns one hook command as a POSIX shell subprocess (`sh -c "<command>"`), streaming stdout/stderr chunks
// to a callback and enforcing an optional timeout. Assumes a POSIX shell is on PATH — Windows-native (no
// WSL/git-bash) isn't supported by this runner.
export interface RunShellCommandOptions {
	command: string;
	cwd: string;
	env: Record<string, string | undefined>;
	/** No timeout when omitted — the caller is fire-and-forget and never awaits this anyway. */
	timeoutMs?: number;
	onChunk?: (stream: "stdout" | "stderr", chunk: string) => void;
}

export interface RunShellCommandResult {
	ok: boolean;
	exitCode: number;
	timedOut: boolean;
}

async function pump(
	stream: ReadableStream<Uint8Array>,
	kind: "stdout" | "stderr",
	onChunk?: (stream: "stdout" | "stderr", chunk: string) => void,
): Promise<void> {
	if (!onChunk) {
		await new Response(stream).text(); // drain so the process doesn't block on a full pipe
		return;
	}
	const decoder = new TextDecoder();
	for await (const value of stream) {
		onChunk(kind, decoder.decode(value, { stream: true }));
	}
}

/**
 * Sends `signal` to every process in `pid`'s process group (`pid` included), not just `pid` itself.
 *
 * `sh -c "<command>"` self-execs into the real command only when it's a single simple command in tail
 * position — anything compound (`&&`, `;`, `|`, a subshell, a backgrounded job, ...) makes `sh` fork a
 * child to run the earlier stage(s), so signalling just the `sh` pid orphans those forked descendants.
 * `Bun.spawn`'s `detached: true` makes the spawned `sh` call `setsid()`, so it becomes the leader of its
 * own new process group (pgid === pid). POSIX `kill(-pgid, signal)` then reaches the leader and every
 * descendant that hasn't broken out of that group — exactly the compound-command case above. Confirmed
 * empirically (not just from docs) against a real `sh -c "sleep 5 & ...; wait"` tree on macOS/arm64.
 */
function killProcessGroup(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
	try {
		process.kill(-pid, signal);
	} catch {
		// ESRCH (group already gone) or a same-shape race — the process tree is dead either way.
	}
}

export async function runShellCommand(
	opts: RunShellCommandOptions,
): Promise<RunShellCommandResult> {
	const proc = Bun.spawn(["sh", "-c", opts.command], {
		cwd: opts.cwd,
		env: opts.env,
		stdout: "pipe",
		stderr: "pipe",
		// Makes `sh` its own process-group leader (via setsid()) so a timeout can kill the whole tree it
		// spawns, not just the `sh` pid Bun handed back — see killProcessGroup() above.
		detached: true,
	});

	let timedOut = false;
	const timeout =
		opts.timeoutMs !== undefined
			? setTimeout(() => {
					timedOut = true;
					killProcessGroup(proc.pid);
				}, opts.timeoutMs)
			: undefined;

	try {
		await Promise.all([
			pump(proc.stdout, "stdout", opts.onChunk),
			pump(proc.stderr, "stderr", opts.onChunk),
		]);
		const exitCode = await proc.exited;
		return { ok: !timedOut && exitCode === 0, exitCode, timedOut };
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
