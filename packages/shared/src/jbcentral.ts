import { existsSync, watch } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { JbcentralInstall } from "@thinkrail/contracts";

export type ParseEnv = Record<string, string | undefined>;

/** The only Central release whose native PI surface this build has reviewed and tested. */
export const REVIEWED_CENTRAL_VERSION = "1.6.2" as const;

const CENTRAL_BIN = "central";
const VERSION_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 120_000;
const UPDATE_TIMEOUT_MS = 300_000;
const MAX_VERSION_OUTPUT_BYTES = 4_096;
const WATCH_RETRY_MS = 250;
const WATCH_EXISTENCE_POLL_MS = 250;

const JBCENTRAL_INSTALL_BASE =
	"https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/central/stable";

export type JbcentralVersionStatus =
	| { state: "absent" }
	| { state: "outdated"; version: string }
	| { state: "supported"; version: typeof REVIEWED_CENTRAL_VERSION; configured: boolean }
	| { state: "unreviewed"; version: string }
	| { state: "malformed-version" }
	| {
			state: "probe-failed";
			reason: "launch-failed" | "timed-out" | "output-too-large" | "nonzero-exit";
	  };

/** Host-private inspection. Only `status` is suitable for mapping to a wire DTO. */
export interface JbcentralInspection {
	executablePath: string | null;
	extensionPath: string;
	artifactExists: boolean;
	status: JbcentralVersionStatus;
}

export type JbcentralAction = "add" | "remove" | "update";

export type JbcentralActionResult =
	| { outcome: "succeeded" }
	| {
			outcome: "failed";
			reason:
				| "not-installed"
				| "launch-failed"
				| "timed-out"
				| "nonzero-exit"
				| "artifact-missing"
				| "artifact-present";
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

export interface JbcentralAdapterDependencies {
	env?: ParseEnv;
	which?: (command: string, path: string) => string | null;
	exists?: (path: string) => boolean;
	run?: (request: ProcessRequest) => Promise<ProcessResult>;
	launchDetached?: (argv: readonly string[]) => boolean;
	watchDirectory?: (path: string, onInvalidate: () => void) => WatchHandle;
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

/**
 * Central's generated PI extension is global by design. It does not follow `PI_CODING_AGENT_DIR`.
 * The path is an opaque identity: callers may check existence and pass it to PI, but must not read it.
 */
export function jbcentralExtensionPath(env: ParseEnv = process.env): string {
	return join(env.HOME ?? homedir(), ".pi", "agent", "extensions", "jetbrains-central.ts");
}

/**
 * Resolve Central from the live PATH, with the installer's default `~/.local/bin` as a fallback.
 * The returned path is always absolute so callers never execute a bare command.
 */
export function resolveJbcentralBin(deps: JbcentralAdapterDependencies = {}): string | null {
	const env = effectiveEnv(deps);
	const path = env.PATH ?? "";
	const which = deps.which ?? ((command, searchPath) => Bun.which(command, { PATH: searchPath }));
	const onPath = which(CENTRAL_BIN, path);
	if (onPath && isAbsolute(onPath)) return onPath;

	const local = join(env.HOME ?? homedir(), ".local", "bin", CENTRAL_BIN);
	return pathExists(local, deps) ? local : null;
}

export function isJbcentralInstalled(deps: JbcentralAdapterDependencies = {}): boolean {
	return resolveJbcentralBin(deps) !== null;
}

/** Parse only Central's version prefix; trailing presentation metadata is ignored and never retained. */
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

	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		processHandle.kill();
	}, request.timeoutMs);

	try {
		const stdoutResult = request.captureStdout
			? await readBounded(
					processHandle.stdout as ReadableStream<Uint8Array>,
					request.maxStdoutBytes,
				)
			: { outcome: "ok" as const, text: "" };
		if (stdoutResult.outcome === "output-too-large") processHandle.kill();
		const exitCode = await processHandle.exited;
		if (timedOut) return { outcome: "timed-out" };
		if (stdoutResult.outcome === "output-too-large") return stdoutResult;
		return { outcome: "exited", exitCode, stdout: stdoutResult.text };
	} finally {
		clearTimeout(timeout);
	}
}

function processRunner(deps: JbcentralAdapterDependencies) {
	return deps.run ?? runProcess;
}

/** Inspect Central without retaining or exposing its raw output. */
export async function inspectJbcentral(
	deps: JbcentralAdapterDependencies = {},
): Promise<JbcentralInspection> {
	const extensionPath = jbcentralExtensionPath(effectiveEnv(deps));
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

	const reviewed = parseJbcentralVersion(`central ${REVIEWED_CENTRAL_VERSION}`);
	if (!reviewed) throw new Error("invalid reviewed Central version constant");
	const comparison = compareVersions(version, reviewed);
	if (comparison < 0) {
		return {
			executablePath,
			extensionPath,
			artifactExists,
			status: { state: "outdated", version: version.text },
		};
	}
	if (comparison > 0) {
		return {
			executablePath,
			extensionPath,
			artifactExists,
			status: { state: "unreviewed", version: version.text },
		};
	}
	return {
		executablePath,
		extensionPath,
		artifactExists,
		status: {
			state: "supported",
			version: REVIEWED_CENTRAL_VERSION,
			configured: artifactExists,
		},
	};
}

const ACTION_ARGS: Record<JbcentralAction, readonly string[]> = {
	add: ["add", "pi"],
	remove: ["remove", "pi"],
	update: ["update", "--install"],
};

/** Run one reviewed Central action and enforce its safe artifact postcondition. */
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

	const artifactExists = pathExists(jbcentralExtensionPath(effectiveEnv(deps)), deps);
	if (action === "add" && !artifactExists) {
		return { outcome: "failed", reason: "artifact-missing" };
	}
	if (action === "remove" && artifactExists) {
		return { outcome: "failed", reason: "artifact-present" };
	}
	return { outcome: "succeeded" };
}

/** Launch Central's browser sign-in without letting its output or errors reach callers. */
export function launchJbcentralLogin(
	deps: JbcentralAdapterDependencies = {},
): JbcentralLoginResult {
	const executablePath = resolveJbcentralBin(deps);
	if (!executablePath) return { outcome: "failed", reason: "not-installed" };

	const launch =
		deps.launchDetached ??
		((argv: readonly string[]) => {
			try {
				Bun.spawn([...argv], {
					stdin: "ignore",
					stdout: "ignore",
					stderr: "ignore",
					env: process.env,
				}).unref();
				return true;
			} catch {
				return false;
			}
		});
	try {
		return launch([executablePath, "login"])
			? { outcome: "launched" }
			: { outcome: "failed", reason: "launch-failed" };
	} catch {
		return { outcome: "failed", reason: "launch-failed" };
	}
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

function nodeWatchDirectory(path: string, onInvalidate: () => void): WatchHandle {
	const watcher = watch(path, { persistent: false }, onInvalidate);
	watcher.on("error", onInvalidate);
	return watcher;
}

/**
 * Observe only Central's reviewed artifact location. Filesystem events report invalidation nudges, while a
 * cheap existence poll repairs dropped add/remove events; neither path opens the artifact. If its directory
 * does not exist yet, the watcher follows the nearest existing parent and re-arms as the tree appears.
 */
export function watchJbcentralArtifact(
	onInvalidate: () => void,
	deps: JbcentralAdapterDependencies = {},
): () => void {
	const extensionPath = jbcentralExtensionPath(effectiveEnv(deps));
	const watchDirectory = deps.watchDirectory ?? nodeWatchDirectory;
	let stopped = false;
	let watchedDirectory: string | null = null;
	let handle: WatchHandle | null = null;
	let rearmTimer: ReturnType<typeof setTimeout> | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let artifactExists = pathExists(extensionPath, deps);

	const closeHandle = (): void => {
		try {
			handle?.close();
		} catch {
			// A watcher invalidated by directory removal may already be closed.
		}
		handle = null;
		watchedDirectory = null;
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
		// Fold the latest existence into the poll baseline so one filesystem event and its later poll do not
		// report the same add/remove transition twice. Events are still hints; the consumer re-inspects.
		artifactExists = pathExists(extensionPath, deps);
		try {
			onInvalidate();
		} catch {
			// The watcher remains armed even if a consumer rejects one nudge.
		}
		scheduleRearm();
	};

	const arm = (): void => {
		if (stopped) return;
		const directory = nearestExistingDirectory(extensionPath, deps);
		if (handle && watchedDirectory === directory) return;
		closeHandle();
		try {
			handle = watchDirectory(directory, invalidate);
			watchedDirectory = directory;
		} catch {
			scheduleRearm(WATCH_RETRY_MS);
		}
	};

	const pollExistence = (): void => {
		if (stopped) return;
		const nextArtifactExists = pathExists(extensionPath, deps);
		if (nextArtifactExists !== artifactExists) {
			artifactExists = nextArtifactExists;
			invalidate();
		}
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

/** The official per-OS Central install plan shown by the guided UI. */
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
