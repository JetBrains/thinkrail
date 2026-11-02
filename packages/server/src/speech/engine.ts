import { randomUUID } from "node:crypto";
import { CodedError } from "@thinkrail/shared/codedError";
import { findFreePort } from "@thinkrail/shared/freePort";
import { logger } from "../log";
import { type Supervised, spawnSupervised } from "../subprocess";
import type { EngineInputs } from "./install";
import { setEngineState } from "./status";

const log = logger("speech");

const HOST = "127.0.0.1";
export const ENGINE_IDLE_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 150;

export interface EngineEndpoint {
	/** The realtime transcription socket, without credentials. */
	realtimeUrl: string;
	apiKey: string;
}

function engineFailed(message: string): CodedError {
	return new CodedError("SPEECH_ENGINE_FAILED", message);
}

async function waitReady(
	child: Supervised,
	port: number,
	apiKey: string,
	signal: AbortSignal,
): Promise<void> {
	let exited = false;
	void child.exited.then(() => {
		exited = true;
	});
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline && !exited && !signal.aborted) {
		try {
			const response = await fetch(`http://${HOST}:${port}/v1/models`, {
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
			});
			if (response.ok) return;
		} catch {}
		await Bun.sleep(READY_POLL_MS);
	}
	if (signal.aborted) throw engineFailed("the speech engine start was cancelled");
	log.warn(`speech engine failed to start: ${child.stderrTail().slice(-500)}`);
	throw engineFailed("the speech engine did not become ready");
}

/**
 * One engine launch, from the moment it is claimed: the child stays reachable while it loads, so a
 * stop or a replacing launch can kill it instead of waiting out the readiness budget.
 */
class EngineRun {
	readonly controller = new AbortController();
	child: Supervised | null = null;
	endpoint: EngineEndpoint | null = null;
	readonly ready: Promise<EngineEndpoint>;

	constructor(
		readonly key: string,
		inputs: EngineInputs,
		previous: EngineRun | null,
	) {
		this.ready = this.start(inputs, previous);
	}

	private async start(inputs: EngineInputs, previous: EngineRun | null): Promise<EngineEndpoint> {
		if (previous) await previous.shutdown();
		const signal = this.controller.signal;
		if (signal.aborted) throw engineFailed("the speech engine start was cancelled");
		setEngineState("starting");
		const port = await findFreePort(0, HOST, 0);
		if (signal.aborted) throw engineFailed("the speech engine start was cancelled");
		const apiKey = randomUUID();
		const child = spawnSupervised([
			inputs.bin,
			"serve",
			"--host",
			HOST,
			"--port",
			String(port),
			"--api-key",
			apiKey,
			"--no-ui",
			"--asr-model",
			inputs.modelPath,
		]);
		this.child = child;
		try {
			await waitReady(child, port, apiKey, signal);
		} catch (err) {
			await child.stop();
			throw err;
		}
		this.endpoint = {
			realtimeUrl: `ws://${HOST}:${port}/v1/audio/transcriptions/realtime`,
			apiKey,
		};
		void child.exited.then((code) => {
			if (current !== this) return;
			current = null;
			log.warn(`speech engine exited unexpectedly (code ${code ?? "signal"})`);
			setEngineState("stopped");
		});
		return this.endpoint;
	}

	/** Kills synchronously on POSIX (the group signal precedes the first await), then waits for exit. */
	async shutdown(): Promise<void> {
		this.controller.abort();
		await this.child?.stop();
		await this.ready.catch(() => {});
	}
}

let current: EngineRun | null = null;
let holds = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleMs = ENGINE_IDLE_MS;

function clearIdle(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = null;
}

function armIdle(): void {
	clearIdle();
	if (holds > 0 || !current?.endpoint) return;
	idleTimer = setTimeout(() => {
		idleTimer = null;
		if (holds === 0) void stopEngine();
	}, idleMs);
	idleTimer.unref?.();
}

/**
 * Starts (or reuses) the engine for these inputs. The launch is claimed before any await, so
 * concurrent callers share one engine and a different model replaces it.
 */
export async function ensureEngine(inputs: EngineInputs): Promise<EngineEndpoint> {
	const key = `${inputs.bin}\0${inputs.modelPath}`;
	if (current?.key !== key) {
		clearIdle();
		const run = new EngineRun(key, inputs, current);
		current = run;
		run.ready.then(
			() => {
				if (current !== run) return;
				setEngineState("ready");
				armIdle();
			},
			() => {
				if (current !== run) return;
				current = null;
				setEngineState(run.controller.signal.aborted ? "stopped" : "failed");
			},
		);
	}
	return current.ready.catch((err: unknown) => {
		throw err instanceof CodedError ? err : engineFailed("the speech engine could not start");
	});
}

/** One live dictation keeps the engine from idling out; call the release when it ends. */
export function holdEngine(): () => void {
	holds += 1;
	clearIdle();
	let released = false;
	return () => {
		if (released) return;
		released = true;
		holds -= 1;
		armIdle();
	};
}

/** Stops the running or starting `nemo-speech serve`, if any, and waits for it to exit. */
export async function stopEngine(): Promise<void> {
	clearIdle();
	const run = current;
	current = null;
	if (!run) return;
	await run.shutdown();
	setEngineState("stopped");
}

export function setEngineIdleMsForTests(ms: number): void {
	idleMs = ms;
}

export function resetEngineForTests(): void {
	holds = 0;
	idleMs = ENGINE_IDLE_MS;
}
