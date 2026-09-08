import { type ChildProcess, spawn } from "node:child_process";

export type BoundedRun = {
	ok: boolean;
	out: string;
	err: string;
	timedOut: boolean;
	launchFailed: boolean;
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

function sink(stream: NodeJS.ReadableStream): Sink {
	const decoder = new TextDecoder();
	let text = "";
	const done = new Promise<void>((resolve) => {
		stream.on("data", (chunk: Buffer) => {
			text += decoder.decode(chunk, { stream: true });
		});
		stream.on("end", () => resolve());
		stream.on("error", () => resolve());
	});
	return {
		text: () => text,
		done,
		cancel: () => {
			(stream as { destroy?: () => void }).destroy?.();
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

function killTree(child: ChildProcess): void {
	if (process.platform !== "win32" && child.pid !== undefined) {
		try {
			process.kill(-child.pid, "SIGKILL");
			return;
		} catch {}
	}
	try {
		child.kill("SIGKILL");
	} catch {}
}

export async function runBounded(argv: string[], opts: BoundedRunOptions): Promise<BoundedRun> {
	const startedAt = performance.now();
	const waitedMs = () => performance.now() - startedAt;
	const [command, ...args] = argv;

	let child: ChildProcess;
	try {
		child = spawn(command ?? "", args, {
			cwd: opts.cwd ?? process.cwd(),
			env: (opts.env ?? process.env) as NodeJS.ProcessEnv,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
			windowsHide: true,
		});
	} catch (cause) {
		const err = cause instanceof Error ? cause.message : String(cause);
		return { ok: false, out: "", err, timedOut: false, launchFailed: true, waitedMs: waitedMs() };
	}

	let launchErrorMessage: string | null = null;
	const errored = new Promise<void>((resolve) => {
		child.once("error", (cause: Error) => {
			launchErrorMessage = cause.message || "launch failed";
			resolve();
		});
	});
	let exitCode: number | null = null;
	const exited = new Promise<void>((resolve) => {
		child.once("exit", (code) => {
			exitCode = code;
			resolve();
		});
	});

	const out = sink(child.stdout as NodeJS.ReadableStream);
	const err = sink(child.stderr as NodeJS.ReadableStream);
	const drained = Promise.all([out.done, err.done]);
	const deadline = delay(boundedTimeout(opts.timeoutMs));

	const outcome = await Promise.race([
		exited.then(() => "exited" as const),
		errored.then(() => "errored" as const),
		deadline.promise.then(() => "timed-out" as const),
	]);
	deadline.cancel();
	if (outcome === "timed-out") killTree(child);
	const grace = delay(DRAIN_GRACE_MS);
	await Promise.race([drained, grace.promise]);
	grace.cancel();
	out.cancel();
	err.cancel();

	if (outcome === "errored" || launchErrorMessage !== null) {
		return {
			ok: false,
			out: "",
			err: launchErrorMessage ?? "launch failed",
			timedOut: false,
			launchFailed: true,
			waitedMs: waitedMs(),
		};
	}

	return {
		ok: outcome === "exited" && exitCode === 0,
		out: out.text(),
		err: err.text(),
		timedOut: outcome === "timed-out",
		launchFailed: false,
		waitedMs: waitedMs(),
	};
}
