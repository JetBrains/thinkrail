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

interface Running {
	child: Supervised;
	key: string;
	endpoint: EngineEndpoint;
}

let running: Running | null = null;
let starting: { key: string; promise: Promise<Running> } | null = null;
let holds = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleMs = ENGINE_IDLE_MS;

function inputsKey(inputs: EngineInputs): string {
	return `${inputs.bin}\0${inputs.modelPath}`;
}

async function waitReady(child: Supervised, port: number, apiKey: string): Promise<void> {
	let exited = false;
	void child.exited.then(() => {
		exited = true;
	});
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (exited) break;
		try {
			const response = await fetch(`http://${HOST}:${port}/v1/models`, {
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(2_000),
			});
			if (response.ok) return;
		} catch {}
		await Bun.sleep(READY_POLL_MS);
	}
	await child.stop();
	throw new CodedError("SPEECH_ENGINE_FAILED", "the speech engine did not become ready");
}

async function launch(inputs: EngineInputs, key: string): Promise<Running> {
	const port = await findFreePort(0, HOST, 0);
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
	try {
		await waitReady(child, port, apiKey);
	} catch (err) {
		log.warn(`speech engine failed to start: ${child.stderrTail().slice(-500)}`);
		throw err;
	}
	const started: Running = {
		child,
		key,
		endpoint: { realtimeUrl: `ws://${HOST}:${port}/v1/audio/transcriptions/realtime`, apiKey },
	};
	void child.exited.then((code) => {
		if (running !== started) return;
		running = null;
		log.warn(`speech engine exited unexpectedly (code ${code ?? "signal"})`);
		setEngineState("stopped");
	});
	return started;
}

function armIdle(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = null;
	if (holds > 0 || !running) return;
	idleTimer = setTimeout(() => {
		idleTimer = null;
		if (holds === 0) void stopEngine();
	}, idleMs);
	idleTimer.unref?.();
}

/** Starts (or reuses) the engine for these inputs; a different model replaces the running one. */
export async function ensureEngine(inputs: EngineInputs): Promise<EngineEndpoint> {
	const key = inputsKey(inputs);
	if (running?.key === key) return running.endpoint;
	if (starting?.key === key) return (await starting.promise).endpoint;
	await stopEngine();
	setEngineState("starting");
	const promise = launch(inputs, key);
	starting = { key, promise };
	try {
		running = await promise;
		setEngineState("ready");
		armIdle();
		return running.endpoint;
	} catch (err) {
		setEngineState("failed");
		throw err instanceof CodedError
			? err
			: new CodedError("SPEECH_ENGINE_FAILED", "the speech engine could not start");
	} finally {
		if (starting?.promise === promise) starting = null;
	}
}

/** One live dictation keeps the engine from idling out; call the release when it ends. */
export function holdEngine(): () => void {
	holds += 1;
	armIdle();
	let released = false;
	return () => {
		if (released) return;
		released = true;
		holds -= 1;
		armIdle();
	};
}

/** Stops the running `nemo-speech serve`, if any, and waits for it to exit. */
export async function stopEngine(): Promise<void> {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = null;
	const pending = starting;
	if (pending) await pending.promise.catch(() => {});
	const current = running;
	running = null;
	if (!current) return;
	await current.child.stop();
	setEngineState("stopped");
}

export function setEngineIdleMsForTests(ms: number): void {
	idleMs = ms;
}

export function resetEngineForTests(): void {
	holds = 0;
	idleMs = ENGINE_IDLE_MS;
}
