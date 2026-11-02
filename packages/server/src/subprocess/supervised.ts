import { killTree, spawnOptions } from "./runBounded";

const STDERR_TAIL_BYTES = 4096;

export type SupervisedOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
};

export type Supervised = {
	pid: number;
	/** The child's exit code, or `null` when it was stopped, signalled, or could not launch. */
	exited: Promise<number | null>;
	/** Kills the whole tree and resolves once the direct child has exited. */
	stop: () => Promise<void>;
	/** The last few KB the child wrote to stderr, for a launch or crash diagnosis. */
	stderrTail: () => string;
};

function drainTail(stream: ReadableStream<Uint8Array>, keep: (text: string) => void): void {
	const decoder = new TextDecoder();
	void (async () => {
		for await (const chunk of stream) keep(decoder.decode(chunk, { stream: true }));
	})().catch(() => {});
}

/**
 * A long-lived host-owned child with the same spawn shape and tree kill as `runBounded`, but no
 * deadline: its lifetime belongs to the caller. Both pipes are drained from spawn so a chatty child
 * never blocks; stdout is discarded.
 */
export function spawnSupervised(argv: string[], opts: SupervisedOptions = {}): Supervised {
	let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		proc = Bun.spawn(argv, spawnOptions(opts));
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		return {
			pid: 0,
			exited: Promise.resolve(null),
			stop: async () => {},
			stderrTail: () => message,
		};
	}
	let tail = "";
	drainTail(proc.stdout, () => {});
	drainTail(proc.stderr, (text) => {
		tail = (tail + text).slice(-STDERR_TAIL_BYTES);
	});
	let killed = false;
	const exited = proc.exited.then((code) => (killed || proc.signalCode ? null : code));
	let stopping: Promise<void> | null = null;
	return {
		pid: proc.pid,
		exited,
		stop: () => {
			stopping ??= (async () => {
				if (proc.exitCode === null && proc.signalCode === null) {
					killed = true;
					await killTree(proc);
				}
				await exited;
			})();
			return stopping;
		},
		stderrTail: () => tail,
	};
}
