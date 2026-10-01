type BoundedRunBase = {
	ok: boolean;
	err: string;
	timedOut: boolean;
	launchFailed: boolean;
	waitedMs: number;
};

export type BoundedRun = BoundedRunBase & { out: string };
export type BoundedBytesRun = BoundedRunBase & { out: Uint8Array };

export type BoundedRunOptions = {
	timeoutMs: number;
	cwd?: string;
	env?: Record<string, string | undefined>;
	stdout?: "text";
};

export type BoundedBytesRunOptions = Omit<BoundedRunOptions, "stdout"> & {
	stdout: "bytes";
};

export type BoundedStreamOptions = Omit<BoundedRunOptions, "stdout">;
export type BoundedStream = {
	stdout: ReadableStream<Uint8Array>;
	exited: Promise<BoundedRunBase>;
};

export const DRAIN_GRACE_MS = 250;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function boundedTimeout(ms: number): number {
	if (Number.isNaN(ms)) return 0;
	if (ms === Number.POSITIVE_INFINITY) return MAX_TIMEOUT_MS;
	return Math.min(Math.max(Math.trunc(ms), 0), MAX_TIMEOUT_MS);
}

type Drain = { done: Promise<void>; cancel: () => void };
type TextSink = Drain & { kind: "text"; value: () => string };
type BytesSink = Drain & { kind: "bytes"; value: () => Uint8Array };

function drain(stream: ReadableStream<Uint8Array>, chunk: (value: Uint8Array) => void): Drain {
	const reader = stream.getReader();
	const done = (async () => {
		while (true) {
			const { done: finished, value } = await reader.read();
			if (finished) return;
			if (value) chunk(value);
		}
	})().catch(() => {});
	return {
		done,
		cancel: () => {
			void reader.cancel().catch(() => {});
		},
	};
}

function textSink(stream: ReadableStream<Uint8Array>): TextSink {
	const decoder = new TextDecoder();
	let text = "";
	return {
		kind: "text",
		value: () => text,
		...drain(stream, (chunk) => {
			text += decoder.decode(chunk, { stream: true });
		}),
	};
}

function bytesSink(stream: ReadableStream<Uint8Array>): BytesSink {
	const chunks: Uint8Array[] = [];
	let length = 0;
	return {
		kind: "bytes",
		value: () => {
			const bytes = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return bytes;
		},
		...drain(stream, (chunk) => {
			chunks.push(chunk.slice());
			length += chunk.byteLength;
		}),
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

function spawnOptions(opts: { cwd?: string; env?: Record<string, string | undefined> }) {
	return {
		cwd: opts.cwd ?? process.cwd(),
		env: opts.env ?? process.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: process.platform !== "win32",
		windowsHide: process.platform === "win32",
	} as const;
}

function launchFailure(cause: unknown, waitedMs: number): BoundedRunBase {
	return {
		ok: false,
		err: cause instanceof Error ? cause.message : String(cause),
		timedOut: false,
		launchFailed: true,
		waitedMs,
	};
}

export function streamBounded(argv: string[], opts: BoundedStreamOptions): BoundedStream {
	const startedAt = performance.now();
	const waitedMs = () => performance.now() - startedAt;

	let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		proc = Bun.spawn(argv, spawnOptions(opts));
	} catch (cause) {
		const failed = launchFailure(cause, waitedMs());
		return {
			stdout: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.error(new Error(failed.err));
				},
			}),
			exited: Promise.resolve(failed),
		};
	}

	const err = textSink(proc.stderr);
	const deadline = delay(boundedTimeout(opts.timeoutMs));
	const exited = (async (): Promise<BoundedRunBase> => {
		const outcome = await Promise.race([
			proc.exited.then(() => "exited" as const),
			deadline.promise.then(() => "timed-out" as const),
		]);
		deadline.cancel();
		if (outcome === "timed-out") killTree(proc);
		const grace = delay(DRAIN_GRACE_MS);
		await Promise.race([err.done, grace.promise]);
		grace.cancel();
		err.cancel();
		return {
			ok: outcome === "exited" && proc.exitCode === 0,
			err: err.value(),
			timedOut: outcome === "timed-out",
			launchFailed: false,
			waitedMs: waitedMs(),
		};
	})();

	const reader = proc.stdout.getReader();
	const stdout = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = await reader.read();
			if (!next.done) {
				controller.enqueue(next.value);
				return;
			}
			const result = await exited;
			if (result.ok) controller.close();
			else
				controller.error(
					new Error(
						result.timedOut
							? `timed out after ${Math.round(result.waitedMs)}ms`
							: result.err || `exited with status ${proc.exitCode}`,
					),
				);
		},
		cancel() {
			void reader.cancel().catch(() => {});
			killTree(proc);
		},
	});
	return { stdout, exited };
}

export function runBounded(argv: string[], opts: BoundedBytesRunOptions): Promise<BoundedBytesRun>;
export function runBounded(argv: string[], opts: BoundedRunOptions): Promise<BoundedRun>;
export async function runBounded(
	argv: string[],
	opts: BoundedRunOptions | BoundedBytesRunOptions,
): Promise<BoundedRun | BoundedBytesRun> {
	const startedAt = performance.now();
	const waitedMs = () => performance.now() - startedAt;

	let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		proc = Bun.spawn(argv, spawnOptions(opts));
	} catch (cause) {
		const failed = launchFailure(cause, waitedMs());
		return opts.stdout === "bytes" ? { ...failed, out: new Uint8Array() } : { ...failed, out: "" };
	}

	const out = opts.stdout === "bytes" ? bytesSink(proc.stdout) : textSink(proc.stdout);
	const err = textSink(proc.stderr);
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

	const result = {
		ok: outcome === "exited" && proc.exitCode === 0,
		err: err.value(),
		timedOut: outcome === "timed-out",
		launchFailed: false,
		waitedMs: waitedMs(),
	};
	return out.kind === "bytes" ? { ...result, out: out.value() } : { ...result, out: out.value() };
}
