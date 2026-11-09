import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
import { findFreePort } from "@thinkrail/shared/freePort";
import { logger } from "../log";
import { runBounded, type Supervised, spawnSupervised } from "../subprocess";
import type { EngineInputs } from "./install";
import { engineRecordsDir } from "./layout";
import { setEngineState } from "./status";

const log = logger("speech");

const HOST = "127.0.0.1";
export const ENGINE_IDLE_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 150;

export interface EngineEndpoint {
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
	throw engineFailed(`the speech engine did not become ready: ${child.stderrTail().slice(-500)}`);
}

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
		const child = spawnSupervised(
			[
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
			],
			{ exitWithParent: true },
		);
		this.child = child;
		recordWindowsEngine(child.pid);
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
			log.warn(
				"speech engine exited unexpectedly",
				engineFailed(`the speech engine exited with ${code ?? "a signal"}`),
			);
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

function ownRecord(): string {
	return join(engineRecordsDir(), `${process.pid}.pid`);
}

/** Records this host's engine; exported for tests, which run the record logic on every platform. */
export function writeEngineRecord(pid: number): void {
	try {
		mkdirSync(engineRecordsDir(), { recursive: true });
		writeFileSync(ownRecord(), String(pid));
	} catch {}
}

export function forgetEngineRecord(): void {
	rmSync(ownRecord(), { force: true });
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Stops every recorded engine whose host is gone, removing its record; a live host's record is left
 * alone. This host's own pid counts as gone: a record under it predates this run (pid reuse).
 */
export async function reapEngineRecords(stop: (pid: number) => Promise<void>): Promise<void> {
	let names: string[];
	try {
		names = readdirSync(engineRecordsDir());
	} catch {
		return;
	}
	for (const name of names) {
		const owner = Number(name.replace(/\.pid$/, ""));
		if (!name.endsWith(".pid") || !Number.isSafeInteger(owner) || owner <= 0) continue;
		if (owner !== process.pid && processAlive(owner)) continue;
		const file = join(engineRecordsDir(), name);
		const pid = Number(readFileSync(file, "utf8").trim());
		rmSync(file, { force: true });
		if (Number.isSafeInteger(pid) && pid > 0) await stop(pid);
	}
}

function recordWindowsEngine(pid: number): void {
	if (process.platform === "win32" && pid !== 0) writeEngineRecord(pid);
}

function forgetWindowsEngine(): void {
	if (process.platform === "win32") forgetEngineRecord();
}

async function stopWindowsEngine(pid: number): Promise<void> {
	const listed = await runBounded(["tasklist", "/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
		timeoutMs: 5_000,
	});
	if (!listed.ok || !/nemo-speech\.exe/i.test(listed.out)) return;
	await runBounded(["taskkill", "/PID", String(pid), "/T", "/F"], { timeoutMs: 5_000 });
	log.info("stopped a speech engine left by a previous run");
}

export async function reapOrphanEngine(): Promise<void> {
	if (process.platform === "win32") await reapEngineRecords(stopWindowsEngine);
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
			(err: unknown) => {
				if (!run.controller.signal.aborted) {
					log.warn(
						"speech engine failed to start",
						err instanceof CodedError ? err : engineFailed("the speech engine could not start"),
					);
				}
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

/** Whether `endpoint` belongs to the engine still running, i.e. it was not stopped on purpose. */
export function isLiveEngine(endpoint: EngineEndpoint): boolean {
	return current?.endpoint === endpoint;
}

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

export async function stopEngine(): Promise<void> {
	clearIdle();
	const run = current;
	current = null;
	if (!run) return;
	await run.shutdown();
	if (current !== null) return;
	forgetWindowsEngine();
	setEngineState("stopped");
}

export function setEngineIdleMsForTests(ms: number): void {
	idleMs = ms;
}

export function resetEngineForTests(): void {
	holds = 0;
	idleMs = ENGINE_IDLE_MS;
}
