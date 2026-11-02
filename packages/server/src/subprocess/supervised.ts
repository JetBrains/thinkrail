import { killTree, spawnOptions } from "./runBounded";

const STDERR_TAIL_BYTES = 4096;

export type SupervisedOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
};

export type Supervised = {
	pid: number;
	exited: Promise<number | null>;
	stop: () => Promise<void>;
	stderrTail: () => string;
};

function drainTail(stream: ReadableStream<Uint8Array>, keep: (text: string) => void): void {
	const decoder = new TextDecoder();
	void (async () => {
		for await (const chunk of stream) keep(decoder.decode(chunk, { stream: true }));
	})().catch(() => {});
}

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
