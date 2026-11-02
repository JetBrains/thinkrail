import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readdir, rename, rm, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	isSpeechErrorCode,
	isSpeechModel,
	SPEECH_MODELS,
	type SpeechErrorCode,
	type SpeechInstallState,
	type SpeechModel,
	type SpeechRuntimeInfo,
} from "@thinkrail/contracts";
import { CodedError, errorCodeOf } from "@thinkrail/shared/codedError";
import { logger } from "../log";
import { runBounded } from "../subprocess";
import { downloadVerified } from "./download";
import { stopEngine } from "./engine";
import { markerPath, modelsDir, runtimeBinary, runtimeDir, speechDir, stagingDir } from "./layout";
import { hostTarget, loadManifest, type RuntimePin, type SpeechManifest } from "./manifest";
import { type PathRuntime, probePathRuntime } from "./pathRuntime";
import { speechStatus, updateSpeechStatus } from "./status";

const log = logger("speech");

const PROGRESS_INTERVAL_MS = 200;
const UNPACK_TIMEOUT_MS = 120_000;
const UNPACKED_RUNTIME_FACTOR = 4;
const DISK_HEADROOM_BYTES = 64 * 1024 * 1024;

export interface EngineInputs {
	bin: string;
	modelPath: string;
	language: string;
	model: SpeechModel;
}

interface Marker {
	model: SpeechModel;
}

let manifest: SpeechManifest | null = null;
let pathRuntime: PathRuntime | null = null;
let active: AbortController | null = null;
let lastInstall: Promise<void> = Promise.resolve();

function pins(): SpeechManifest {
	manifest ??= loadManifest();
	return manifest;
}

function runtimePin(): RuntimePin | null {
	const target = hostTarget();
	return target ? (pins().runtimes[target] ?? null) : null;
}

function managedDir(): string | null {
	const target = hostTarget();
	return target ? runtimeDir(pins().runtimeVersion, target) : null;
}

function managedBinary(): string | null {
	const dir = managedDir();
	if (!dir) return null;
	const bin = runtimeBinary(dir);
	return existsSync(bin) ? bin : null;
}

function modelPath(model: SpeechModel): string {
	return join(modelsDir(), pins().models[model].fileName);
}

function modelPresent(model: SpeechModel): boolean {
	try {
		return Bun.file(modelPath(model)).size === pins().models[model].bytes;
	} catch {
		return false;
	}
}

function readMarker(): Marker | null {
	try {
		const model = Reflect.get(JSON.parse(readFileSync(markerPath(), "utf8")), "model");
		return isSpeechModel(model) ? { model } : null;
	} catch {
		return null;
	}
}

function runtimeInfo(): SpeechRuntimeInfo | null {
	if (pathRuntime) {
		return { source: "path", version: pathRuntime.version, backend: pathRuntime.backend };
	}
	const pin = runtimePin();
	if (pin && managedBinary()) {
		return { source: "managed", version: pins().runtimeVersion, backend: pin.backend };
	}
	return null;
}

function installedState(): SpeechInstallState {
	const marker = readMarker();
	if (marker && modelPresent(marker.model) && runtimeInfo()) {
		return { status: "ready", model: marker.model };
	}
	return { status: "not-installed" };
}

async function diskUsage(dir: string): Promise<number> {
	let total = 0;
	let entries: string[];
	try {
		entries = await readdir(dir, { recursive: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		try {
			const info = await lstat(join(dir, entry));
			if (info.isFile()) total += info.size;
		} catch {}
	}
	return total;
}

function downloadBytes(): Record<SpeechModel, number> {
	const runtimeBytes = pathRuntime || managedBinary() ? 0 : (runtimePin()?.bytes ?? 0);
	const result = { multilingual: 0, english: 0 };
	for (const model of SPEECH_MODELS) {
		result[model] = runtimeBytes + (modelPresent(model) ? 0 : pins().models[model].bytes);
	}
	return result;
}

async function refresh(install: SpeechInstallState = installedState()): Promise<void> {
	updateSpeechStatus({
		supported: runtimePin() !== null,
		install,
		runtime: runtimeInfo(),
		diskBytes: await diskUsage(speechDir()),
		downloadBytes: downloadBytes(),
	});
}

export async function initSpeech(): Promise<void> {
	manifest = null;
	pathRuntime = null;
	updateSpeechStatus({
		supported: runtimePin() !== null,
		install: installedState(),
		runtime: runtimeInfo(),
		downloadBytes: downloadBytes(),
	});
	if (runtimePin()) pathRuntime = await probePathRuntime(pins().runtimeVersion);
	await refresh();
}

/** Reads the disk, not the status: a failed or running switch leaves the installed model usable. */
export function engineInputs(): EngineInputs | null {
	const installed = installedState();
	if (installed.status !== "ready") return null;
	const bin = pathRuntime?.bin ?? managedBinary();
	if (!bin) return null;
	return {
		bin,
		modelPath: modelPath(installed.model),
		language: pins().models[installed.model].language,
		model: installed.model,
	};
}

async function ensureFreeSpace(neededBytes: number): Promise<void> {
	if (neededBytes === 0) return;
	let available: number;
	try {
		const fs = await statfs(speechDir());
		available = fs.bavail * fs.bsize;
	} catch {
		return;
	}
	if (available < neededBytes + DISK_HEADROOM_BYTES) {
		throw new CodedError("SPEECH_DISK_SPACE", "not enough free disk space for voice input");
	}
}

function partialBytes(path: string): number {
	try {
		return Bun.file(`${path}.partial`).size;
	} catch {
		return 0;
	}
}

function tarCommand(): string {
	if (process.platform === "win32") {
		return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
	}
	return Bun.which("tar", { PATH: process.env.PATH ?? "" }) ?? "/usr/bin/tar";
}

async function installRuntime(
	pin: RuntimePin,
	signal: AbortSignal,
	progress: (received: number) => void,
): Promise<void> {
	const dest = managedDir();
	if (!dest) throw new CodedError("SPEECH_UNSUPPORTED_PLATFORM", "no runtime for this platform");
	const archive = join(stagingDir(), pin.url.slice(pin.url.lastIndexOf("/") + 1));
	await downloadVerified(pin, archive, { signal, onProgress: progress });
	const unpack = join(stagingDir(), `unpack-${crypto.randomUUID()}`);
	await mkdir(unpack, { recursive: true });
	try {
		const run = await runBounded([tarCommand(), "-xf", archive, "-C", unpack], {
			timeoutMs: UNPACK_TIMEOUT_MS,
			signal,
		});
		if (!run.ok) throw new CodedError("SPEECH_DOWNLOAD_FAILED", "could not unpack the runtime");
		const root = join(unpack, pin.root);
		if (!existsSync(runtimeBinary(root))) {
			throw new CodedError("SPEECH_DOWNLOAD_FAILED", "runtime archive has no nemo-speech binary");
		}
		await rm(dest, { recursive: true, force: true });
		await mkdir(join(dest, ".."), { recursive: true });
		await rename(root, dest);
	} finally {
		await rm(unpack, { recursive: true, force: true });
		await rm(archive, { force: true });
	}
}

async function runInstall(model: SpeechModel, signal: AbortSignal): Promise<void> {
	const pin = runtimePin();
	if (!pin) throw new CodedError("SPEECH_UNSUPPORTED_PLATFORM", "no runtime for this platform");
	await mkdir(stagingDir(), { recursive: true });
	await mkdir(modelsDir(), { recursive: true });
	pathRuntime ??= await probePathRuntime(pins().runtimeVersion);
	const modelPin = pins().models[model];
	const needRuntime = !pathRuntime && !managedBinary();
	const needModel = !modelPresent(model);
	const modelFile = modelPath(model);
	await ensureFreeSpace(
		(needRuntime ? pin.bytes * UNPACKED_RUNTIME_FACTOR : 0) +
			(needModel ? modelPin.bytes - partialBytes(modelFile) : 0),
	);
	let lastPublish = 0;
	const reporter = (phase: "runtime" | "model", totalBytes: number) => (receivedBytes: number) => {
		const now = Date.now();
		if (now - lastPublish < PROGRESS_INTERVAL_MS && receivedBytes < totalBytes) return;
		lastPublish = now;
		updateSpeechStatus({
			install: { status: "installing", model, phase, receivedBytes, totalBytes },
		});
	};
	if (needRuntime) await installRuntime(pin, signal, reporter("runtime", pin.bytes));
	if (needModel) {
		await downloadVerified(modelPin, modelFile, {
			signal,
			onProgress: reporter("model", modelPin.bytes),
		});
	}
	await writeFile(markerPath(), JSON.stringify({ model } satisfies Marker));
	await stopEngine();
	for (const other of SPEECH_MODELS) {
		if (other === model) continue;
		await rm(modelPath(other), { force: true });
		await rm(`${modelPath(other)}.partial`, { force: true });
	}
}

async function discardPartials(): Promise<void> {
	await rm(stagingDir(), { recursive: true, force: true });
	for (const model of SPEECH_MODELS) await rm(`${modelPath(model)}.partial`, { force: true });
}

export function installSpeech(model: SpeechModel): void {
	if (!runtimePin()) {
		throw new CodedError("SPEECH_UNSUPPORTED_PLATFORM", "voice input is unavailable here");
	}
	if (active) throw new CodedError("SPEECH_INSTALL_BUSY", "voice input is already installing");
	if (speechStatus().install.status === "ready" && readMarker()?.model === model) return;
	const controller = new AbortController();
	updateSpeechStatus({
		install: { status: "installing", model, phase: "runtime", receivedBytes: 0, totalBytes: 0 },
	});
	const done = (async () => {
		let outcome: SpeechInstallState | undefined;
		try {
			await runInstall(model, controller.signal);
		} catch (err) {
			if (controller.signal.aborted) {
				await discardPartials().catch(() => {});
			} else {
				const raw = errorCodeOf(err);
				const code: SpeechErrorCode = isSpeechErrorCode(raw) ? raw : "SPEECH_DOWNLOAD_FAILED";
				log.warn(`voice install failed (${code})`, err);
				const installed = installedState();
				outcome = {
					status: "failed",
					model,
					code,
					usable: installed.status === "ready" ? installed.model : null,
				};
			}
		}
		if (active === controller) active = null;
		await refresh(outcome).catch((err) => log.warn("voice status refresh failed", err));
	})();
	active = controller;
	lastInstall = done;
}

export function cancelSpeechInstall(): void {
	active?.abort();
}

export async function speechInstallSettled(): Promise<void> {
	await lastInstall;
}

export async function removeSpeech(): Promise<void> {
	cancelSpeechInstall();
	await speechInstallSettled();
	await stopEngine();
	await rm(speechDir(), { recursive: true, force: true });
	await refresh();
}

export function resetSpeechInstallForTests(): void {
	active?.abort();
	active = null;
	lastInstall = Promise.resolve();
	manifest = null;
	pathRuntime = null;
}
