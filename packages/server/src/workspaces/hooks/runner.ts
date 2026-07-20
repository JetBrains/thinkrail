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

export async function runShellCommand(
	opts: RunShellCommandOptions,
): Promise<RunShellCommandResult> {
	const proc = Bun.spawn(["sh", "-c", opts.command], {
		cwd: opts.cwd,
		env: opts.env,
		stdout: "pipe",
		stderr: "pipe",
	});

	let timedOut = false;
	const timeout =
		opts.timeoutMs !== undefined
			? setTimeout(() => {
					timedOut = true;
					proc.kill();
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
