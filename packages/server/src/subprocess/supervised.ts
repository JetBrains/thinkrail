import { killTree, spawnOptions } from "./runBounded";

const STDERR_TAIL_BYTES = 4096;

export type SupervisedOptions = {
	cwd?: string;
	env?: Record<string, string | undefined>;
	/** POSIX: the child dies with the host even when the host is SIGKILLed. */
	exitWithParent?: boolean;
};

const WATCHDOG =
	'exec 3<&0; "$@" </dev/null & child=$!; (read _ <&3; kill "$child" 2>/dev/null) & watcher=$!; wait "$child"; status=$?; kill "$watcher" 2>/dev/null; if [ "$status" -gt 128 ]; then trap - "$(kill -l "$status")"; kill -s "$(kill -l "$status")" $$; fi; exit "$status"';

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
	const watched = opts.exitWithParent === true && process.platform !== "win32";
	let proc: Bun.Subprocess<"ignore" | "pipe", "pipe", "pipe">;
	try {
		proc = watched
			? Bun.spawn(["/bin/sh", "-c", WATCHDOG, "sh", ...argv], {
					...spawnOptions(opts),
					stdin: "pipe",
				})
			: Bun.spawn(argv, spawnOptions(opts));
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
