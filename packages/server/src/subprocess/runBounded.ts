export type BoundedRun = {
	ok: boolean;
	out: string;
	err: string;
	timedOut: boolean;
	waitedMs: number;
};

export type BoundedRunOptions = {
	timeoutMs: number;
	cwd?: string;
	env?: Record<string, string | undefined>;
};

export const DRAIN_GRACE_MS = 250;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function boundedTimeout(ms: number): number {
	if (Number.isNaN(ms)) return 0;
	if (ms === Number.POSITIVE_INFINITY) return MAX_TIMEOUT_MS;
	return Math.min(Math.max(Math.trunc(ms), 0), MAX_TIMEOUT_MS);
}

type Sink = { text: () => string; done: Promise<void>; cancel: () => void };

function sink(stream: ReadableStream<Uint8Array>): Sink {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	const done = (async () => {
		while (true) {
			const { done: finished, value } = await reader.read();
			if (finished) return;
			if (value) text += decoder.decode(value, { stream: true });
		}
	})().catch(() => {});
	return {
		text: () => text,
		done,
		cancel: () => {
			void reader.cancel().catch(() => {});
		},
	};
}

function delay(ms: number): { promise: Promise<void>; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const promise = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, ms);
		timer.unref();
	});
	return { promise, cancel: () => clearTimeout(timer) };
}

function killTree(proc: Bun.Subprocess): void {
	if (process.platform !== "win32") {
		try {
			process.kill(-proc.pid, "SIGKILL");
			return;
		} catch {
			proc.kill("SIGKILL");
			return;
		}
	}
	proc.kill("SIGKILL");
}

export async function runBounded(argv: string[], opts: BoundedRunOptions): Promise<BoundedRun> {
	const startedAt = performance.now();
	const waitedMs = () => performance.now() - startedAt;

	let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		proc = Bun.spawn(argv, {
			cwd: opts.cwd ?? process.cwd(),
			env: opts.env ?? process.env,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			detached: true,
		});
	} catch (cause) {
		const err = cause instanceof Error ? cause.message : String(cause);
		return { ok: false, out: "", err, timedOut: false, waitedMs: waitedMs() };
	}

	const out = sink(proc.stdout);
	const err = sink(proc.stderr);
	const drained = Promise.all([out.done, err.done]);
	const deadline = delay(boundedTimeout(opts.timeoutMs));

	const outcome = await Promise.race([
		proc.exited.then(() => "exited" as const),
		deadline.promise.then(() => "timed-out" as const),
	]);
	deadline.cancel();
	if (outcome === "timed-out") killTree(proc);
	const grace = delay(DRAIN_GRACE_MS);
	await Promise.race([drained, grace.promise]);
	grace.cancel();
	out.cancel();
	err.cancel();

	return {
		ok: outcome === "exited" && proc.exitCode === 0,
		out: out.text(),
		err: err.text(),
		timedOut: outcome === "timed-out",
		waitedMs: waitedMs(),
	};
}
