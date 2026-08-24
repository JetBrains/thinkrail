import { existsSync, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { JbcentralInstall } from "@thinkrail/contracts";

export type ParseEnv = Record<string, string | undefined>;

export const MINIMUM_CENTRAL_VERSION = "1.4.0" as const;

const CENTRAL_BIN = "central";
const VERSION_TIMEOUT_MS = 5_000;
const STATUS_TIMEOUT_MS = 15_000;
const LOGIN_GRACE_MS = 1_500;
const MAX_STATUS_OUTPUT_BYTES = 16_384;
const ACTION_TIMEOUT_MS = 120_000;
const UPDATE_TIMEOUT_MS = 300_000;
const MAX_VERSION_OUTPUT_BYTES = 4_096;
const WATCH_RETRY_MS = 250;
const WATCH_EXISTENCE_POLL_MS = 250;

const JBCENTRAL_INSTALL_BASE = "https://central-cli.labs.jb.gg";

export type JbcentralVersionStatus =
	| { state: "absent" }
	| { state: "outdated"; version: string }
	| { state: "supported"; version: string; configured: boolean }
	| { state: "malformed-version" }
	| {
			state: "probe-failed";
			reason: "launch-failed" | "timed-out" | "output-too-large" | "nonzero-exit";
	  };

export interface JbcentralInspection {
	executablePath: string | null;
	extensionPath: string;
	artifactExists: boolean;
	status: JbcentralVersionStatus;
}

export type JbcentralAction = "add" | "remove" | "update" | "start-proxy";

export type JbcentralAuthVerdict = "connected" | "signed-out" | "unknown";

export type JbcentralProxyVerdict = "stopped" | "unknown";

export interface JbcentralStatusObservation {
	auth: JbcentralAuthVerdict;
	proxy: JbcentralProxyVerdict;
}

export type JbcentralActionResult =
	| { outcome: "succeeded"; observation?: JbcentralStatusObservation }
	| {
			outcome: "failed";
			reason:
				| "not-installed"
				| "launch-failed"
				| "timed-out"
				| "nonzero-exit"
				| "artifact-missing"
				| "artifact-present"
				| "proxy-stopped";
	  };

export type JbcentralLoginResult =
	| { outcome: "launched" }
	| { outcome: "failed"; reason: "not-installed" | "launch-failed" };

interface ProcessRequest {
	argv: readonly string[];
	captureStdout: boolean;
	timeoutMs: number;
	maxStdoutBytes: number;
}

type ProcessResult =
	| { outcome: "exited"; exitCode: number; stdout: string }
	| { outcome: "launch-failed" | "timed-out" | "output-too-large" };

interface WatchHandle {
	close(): void;
}

interface LoginHandle {
	exited: Promise<number>;
}

export interface JbcentralAdapterDependencies {
	env?: ParseEnv;
	platform?: NodeJS.Platform;
	which?: (command: string, path: string) => string | null;
	exists?: (path: string) => boolean;
	run?: (request: ProcessRequest) => Promise<ProcessResult>;
	launchDetached?: (argv: readonly string[]) => LoginHandle | null;
	watchDirectory?: (path: string, onEntry: (entry: string | null) => void) => WatchHandle;
}

interface SemanticVersion {
	major: number;
	minor: number;
	patch: number;
	text: string;
}

function effectiveEnv(deps: JbcentralAdapterDependencies): ParseEnv {
	return deps.env ?? process.env;
}

function pathExists(path: string, deps: JbcentralAdapterDependencies): boolean {
	return (deps.exists ?? existsSync)(path);
}

function platformOf(deps: JbcentralAdapterDependencies): NodeJS.Platform {
	return deps.platform ?? process.platform;
}

function homeDirectory(deps: JbcentralAdapterDependencies): string {
	const env = effectiveEnv(deps);
	return (platformOf(deps) === "win32" ? env.USERPROFILE : env.HOME) ?? homedir();
}

function centralExecutableName(deps: JbcentralAdapterDependencies): string {
	return platformOf(deps) === "win32" ? `${CENTRAL_BIN}.exe` : CENTRAL_BIN;
}

export function jbcentralExtensionPath(deps: JbcentralAdapterDependencies = {}): string {
	return join(homeDirectory(deps), ".pi", "agent", "extensions", "jetbrains-central.ts");
}

export function resolveJbcentralBin(deps: JbcentralAdapterDependencies = {}): string | null {
	const env = effectiveEnv(deps);
	const path = env.PATH ?? "";
	const which = deps.which ?? ((command, searchPath) => Bun.which(command, { PATH: searchPath }));
	const onPath = which(CENTRAL_BIN, path);
	if (onPath && isAbsolute(onPath)) return onPath;

	const local = join(homeDirectory(deps), ".local", "bin", centralExecutableName(deps));
	return pathExists(local, deps) ? local : null;
}

export function isJbcentralInstalled(deps: JbcentralAdapterDependencies = {}): boolean {
	return resolveJbcentralBin(deps) !== null;
}

export function parseJbcentralVersion(output: string): SemanticVersion | null {
	const match = /^central\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)/u.exec(output.trim());
	if (!match) return null;
	const [, majorText, minorText, patchText] = match;
	const major = Number(majorText);
	const minor = Number(minorText);
	const patch = Number(patchText);
	if (![major, minor, patch].every(Number.isSafeInteger)) return null;
	return { major, minor, patch, text: `${major}.${minor}.${patch}` };
}

function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
	return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

async function readBounded(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
): Promise<{ outcome: "ok"; text: string } | { outcome: "output-too-large" }> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > maxBytes) {
				await reader.cancel();
				return { outcome: "output-too-large" };
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { outcome: "ok", text: new TextDecoder().decode(bytes) };
}

async function runProcess(request: ProcessRequest): Promise<ProcessResult> {
	let processHandle: ReturnType<typeof Bun.spawn>;
	try {
		processHandle = Bun.spawn([...request.argv], {
			stdin: "ignore",
			stdout: request.captureStdout ? "pipe" : "ignore",
			stderr: "ignore",
			env: process.env,
		});
	} catch {
		return { outcome: "launch-failed" };
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<ProcessResult>((resolve) => {
		timer = setTimeout(() => {
			processHandle.kill();
			resolve({ outcome: "timed-out" });
		}, request.timeoutMs);
	});

	const completion = (async (): Promise<ProcessResult> => {
		const stdoutResult = request.captureStdout
			? await readBounded(
					processHandle.stdout as ReadableStream<Uint8Array>,
					request.maxStdoutBytes,
				)
			: { outcome: "ok" as const, text: "" };
		if (stdoutResult.outcome === "output-too-large") {
			processHandle.kill();
			return stdoutResult;
		}
		const exitCode = await processHandle.exited;
		return { outcome: "exited", exitCode, stdout: stdoutResult.text };
	})();
	completion.catch(() => {});

	try {
		return await Promise.race([completion, deadline]);
	} finally {
		clearTimeout(timer);
	}
}

function processRunner(deps: JbcentralAdapterDependencies) {
	return deps.run ?? runProcess;
}

export async function inspectJbcentral(
	deps: JbcentralAdapterDependencies = {},
): Promise<JbcentralInspection> {
	const extensionPath = jbcentralExtensionPath(deps);
	const artifactExists = pathExists(extensionPath, deps);
	const executablePath = resolveJbcentralBin(deps);
	if (!executablePath) {
		return { executablePath: null, extensionPath, artifactExists, status: { state: "absent" } };
	}

	let result: ProcessResult;
	try {
		result = await processRunner(deps)({
			argv: [executablePath, "--version"],
			captureStdout: true,
			timeoutMs: VERSION_TIMEOUT_MS,
			maxStdoutBytes: MAX_VERSION_OUTPUT_BYTES,
		});
	} catch {
		return {
			executablePath,
			extensionPath,
			artifactExists,
			status: { state: "probe-failed", reason: "launch-failed" },
		};
	}
	if (result.outcome !== "exited") {
		return {
			executablePath,
			extensionPath,
			artifactExists,
			status: { state: "probe-failed", reason: result.outcome },
		};
	}
	if (result.exitCode !== 0) {
		return {
			executablePath,
			extensionPath,
			artifactExists,
			status: { state: "probe-failed", reason: "nonzero-exit" },
		};
	}

	const version = parseJbcentralVersion(result.stdout);
	if (!version) {
		return {
			executablePath,
			extensionPath,
			artifactExists,
			status: { state: "malformed-version" },
		};
	}

	const minimum = parseJbcentralVersion(`central ${MINIMUM_CENTRAL_VERSION}`);
	if (!minimum) throw new Error("invalid minimum Central version constant");
	if (compareVersions(version, minimum) < 0) {
		return {
			executablePath,
			extensionPath,
			artifactExists,
			status: { state: "outdated", version: version.text },
		};
	}
	return {
		executablePath,
		extensionPath,
		artifactExists,
		status: {
			state: "supported",
			version: version.text,
			configured: artifactExists,
		},
	};
}

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const AUTH_ROW = /(?:^|\s)Auth\s+(\S.*)$/u;
const PROXY_ROW = /(?:^|\s)Proxy\s+(\S.*)$/u;
const SIGNED_OUT_MARKER = "not connected";
const PROXY_STOPPED_MARKER = "stopped";
const UNKNOWN_STATUS: JbcentralStatusObservation = { auth: "unknown", proxy: "unknown" };

export function parseJbcentralStatusObservation(output: string): JbcentralStatusObservation {
	let auth: JbcentralAuthVerdict = "unknown";
	let proxy: JbcentralProxyVerdict = "unknown";
	for (const line of output.replace(ANSI_SGR, "").split("\n")) {
		const normalized = line.replace(/\s+/gu, " ").trim();
		const authRow = AUTH_ROW.exec(normalized);
		if (authRow?.[1]) {
			auth = authRow[1].includes(SIGNED_OUT_MARKER) ? "signed-out" : "connected";
		}
		const proxyRow = PROXY_ROW.exec(normalized);
		if (proxyRow?.[1] === PROXY_STOPPED_MARKER) proxy = "stopped";
	}
	return { auth, proxy };
}

export const JBCENTRAL_STATUS_TTL_MS = 3_000;

export async function probeJbcentralStatus(
	deps: JbcentralAdapterDependencies = {},
): Promise<JbcentralStatusObservation> {
	const executablePath = resolveJbcentralBin(deps);
	if (!executablePath) return UNKNOWN_STATUS;

	let result: ProcessResult;
	try {
		result = await processRunner(deps)({
			argv: [executablePath, "status"],
			captureStdout: true,
			timeoutMs: STATUS_TIMEOUT_MS,
			maxStdoutBytes: MAX_STATUS_OUTPUT_BYTES,
		});
	} catch {
		return UNKNOWN_STATUS;
	}
	if (result.outcome !== "exited" || result.exitCode !== 0) return UNKNOWN_STATUS;
	return parseJbcentralStatusObservation(result.stdout);
}

const ACTION_ARGS: Record<JbcentralAction, readonly string[]> = {
	add: ["add", "pi"],
	remove: ["remove", "pi"],
	update: ["update", "--install"],
	"start-proxy": ["proxy", "start", "--ensure-updated"],
};

export async function runJbcentralAction(
	action: JbcentralAction,
	deps: JbcentralAdapterDependencies = {},
): Promise<JbcentralActionResult> {
	const executablePath = resolveJbcentralBin(deps);
	if (!executablePath) return { outcome: "failed", reason: "not-installed" };

	let result: ProcessResult;
	try {
		result = await processRunner(deps)({
			argv: [executablePath, ...ACTION_ARGS[action]],
			captureStdout: false,
			timeoutMs: action === "update" ? UPDATE_TIMEOUT_MS : ACTION_TIMEOUT_MS,
			maxStdoutBytes: 0,
		});
	} catch {
		return { outcome: "failed", reason: "launch-failed" };
	}
	if (result.outcome !== "exited") {
		return {
			outcome: "failed",
			reason: result.outcome === "output-too-large" ? "launch-failed" : result.outcome,
		};
	}
	if (result.exitCode !== 0) return { outcome: "failed", reason: "nonzero-exit" };

	const artifactExists = pathExists(jbcentralExtensionPath(deps), deps);
	if (action === "add" && !artifactExists) {
		return { outcome: "failed", reason: "artifact-missing" };
	}
	if (action === "remove" && artifactExists) {
		return { outcome: "failed", reason: "artifact-present" };
	}
	if (action === "start-proxy") {
		const observation = await probeJbcentralStatus(deps);
		return observation.proxy === "stopped"
			? { outcome: "failed", reason: "proxy-stopped" }
			: { outcome: "succeeded", observation };
	}
	return { outcome: "succeeded" };
}

export async function launchJbcentralLogin(
	deps: JbcentralAdapterDependencies = {},
): Promise<JbcentralLoginResult> {
	const executablePath = resolveJbcentralBin(deps);
	if (!executablePath) return { outcome: "failed", reason: "not-installed" };

	const launch =
		deps.launchDetached ??
		((argv: readonly string[]) => {
			const processHandle = Bun.spawn([...argv], {
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
				env: process.env,
			});
			processHandle.unref();
			return { exited: processHandle.exited };
		});

	let handle: LoginHandle | null;
	try {
		handle = launch([executablePath, "login"]);
	} catch {
		return { outcome: "failed", reason: "launch-failed" };
	}
	if (!handle) return { outcome: "failed", reason: "launch-failed" };

	let timer: ReturnType<typeof setTimeout> | undefined;
	const survived = Symbol("survived");
	try {
		const early = await Promise.race([
			handle.exited.catch(() => 1),
			new Promise<typeof survived>((resolve) => {
				timer = setTimeout(() => resolve(survived), LOGIN_GRACE_MS);
			}),
		]);
		if (early !== survived && early !== 0) return { outcome: "failed", reason: "launch-failed" };
	} catch {
		return { outcome: "failed", reason: "launch-failed" };
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
	return { outcome: "launched" };
}

function nearestExistingDirectory(path: string, deps: JbcentralAdapterDependencies): string {
	let candidate = dirname(path);
	while (!pathExists(candidate, deps)) {
		const parent = dirname(candidate);
		if (parent === candidate) return candidate;
		candidate = parent;
	}
	return candidate;
}

function nodeWatchDirectory(path: string, onEntry: (entry: string | null) => void): WatchHandle {
	const watcher = watch(path, { persistent: false }, (_event, filename) =>
		onEntry(typeof filename === "string" ? filename : null),
	);
	watcher.on("error", () => onEntry(null));
	return watcher;
}

export function watchJbcentralArtifact(
	onInvalidate: () => void,
	deps: JbcentralAdapterDependencies = {},
): () => void {
	const extensionPath = jbcentralExtensionPath(deps);
	const artifactDirectory = dirname(extensionPath);
	const artifactName = basename(extensionPath);
	const watchDirectory = deps.watchDirectory ?? nodeWatchDirectory;
	let stopped = false;
	let watchedDirectory: string | null = null;
	let handle: WatchHandle | null = null;
	let rearmTimer: ReturnType<typeof setTimeout> | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let artifactExists = pathExists(extensionPath, deps);
	let watchGeneration = 0;

	const closeHandle = (): void => {
		try {
			handle?.close();
		} catch {}
		handle = null;
		watchedDirectory = null;
		watchGeneration += 1;
	};

	const scheduleRearm = (delay = 0): void => {
		if (stopped || rearmTimer) return;
		rearmTimer = setTimeout(() => {
			rearmTimer = null;
			arm();
		}, delay);
	};

	const invalidate = (): void => {
		if (stopped) return;
		artifactExists = pathExists(extensionPath, deps);
		try {
			onInvalidate();
		} catch {}
		scheduleRearm();
	};

	const syncExistence = (): boolean => {
		const next = pathExists(extensionPath, deps);
		if (next === artifactExists) return false;
		artifactExists = next;
		return true;
	};

	const handleEntry = (entry: string | null, directory: string, generation: number): void => {
		if (stopped || generation !== watchGeneration) return;
		if (directory === artifactDirectory) {
			if (entry === null) closeHandle();
			if (entry === null || entry === artifactName) invalidate();
			return;
		}
		if (syncExistence()) invalidate();
		else scheduleRearm();
	};

	const arm = (): void => {
		if (stopped) return;
		const directory = nearestExistingDirectory(extensionPath, deps);
		if (handle && watchedDirectory === directory) return;
		closeHandle();
		const generation = watchGeneration;
		try {
			handle = watchDirectory(directory, (entry) => handleEntry(entry, directory, generation));
			watchedDirectory = directory;
		} catch {
			scheduleRearm(WATCH_RETRY_MS);
		}
	};

	const pollExistence = (): void => {
		if (stopped) return;
		if (syncExistence()) invalidate();
		pollTimer = setTimeout(pollExistence, WATCH_EXISTENCE_POLL_MS);
		pollTimer.unref?.();
	};

	arm();
	pollTimer = setTimeout(pollExistence, WATCH_EXISTENCE_POLL_MS);
	pollTimer.unref?.();
	return () => {
		stopped = true;
		if (rearmTimer) clearTimeout(rearmTimer);
		if (pollTimer) clearTimeout(pollTimer);
		rearmTimer = null;
		pollTimer = null;
		closeHandle();
	};
}

export function jbcentralInstall(platform: NodeJS.Platform): JbcentralInstall {
	if (platform === "win32") {
		return {
			platform,
			shell: "powershell",
			command: `irm ${JBCENTRAL_INSTALL_BASE}/install.ps1 | iex`,
		};
	}
	return {
		platform,
		shell: "bash",
		command: `curl -fsSL ${JBCENTRAL_INSTALL_BASE}/install.sh | bash`,
	};
}
