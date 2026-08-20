import { existsSync, watch } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { JbcentralInstall } from "@thinkrail/contracts";

export type ParseEnv = Record<string, string | undefined>;

/** The oldest Central release that carries the native PI surface (`central add pi`). */
export const MINIMUM_CENTRAL_VERSION = "1.4.0" as const;

const CENTRAL_BIN = "central";
const VERSION_TIMEOUT_MS = 5_000;
const STATUS_TIMEOUT_MS = 15_000;
/** How long a launched `central login` must survive before it counts as actually running. */
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

/** Host-private inspection. Only `status` is suitable for mapping to a wire DTO. */
export interface JbcentralInspection {
	executablePath: string | null;
	extensionPath: string;
	artifactExists: boolean;
	status: JbcentralVersionStatus;
}

export type JbcentralAction = "add" | "remove" | "update" | "start-proxy";

/**
 * Whether Central currently holds credentials. `unknown` is a first-class answer: the probe is allowed to
 * fail, and a failed probe must never be presented as a sign-in demand.
 */
export type JbcentralAuthVerdict = "connected" | "signed-out" | "unknown";

/** Only a positively observed stopped marker is actionable; every other rendering stays non-demanding. */
export type JbcentralProxyVerdict = "stopped" | "unknown";

/** Closed observations extracted from one bounded `central status` invocation. */
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

/** What a launched login exposes: just enough to notice it died, never its output. */
interface LoginHandle {
	exited: Promise<number>;
}

export interface JbcentralAdapterDependencies {
	env?: ParseEnv;
	which?: (command: string, path: string) => string | null;
	exists?: (path: string) => boolean;
	run?: (request: ProcessRequest) => Promise<ProcessResult>;
	launchDetached?: (argv: readonly string[]) => LoginHandle | null;
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

/** Central's global artifact — ignores `PI_CODING_AGENT_DIR`; an opaque identity, never read. */
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

	// The deadline has to win the race outright, not merely fire a kill: killing the child does not close a
	// pipe its own grandchildren still hold open (Central spawns a proxy daemon), so awaiting the read first
	// would let a probe outlive its timeout by as long as that daemon lives — and the version probe is on the
	// host's boot path, where an unbounded wait means no port, no UI, and no error.
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
	// A completion that loses the race still settles later; nothing may surface as an unhandled rejection.
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

/** Central styles its rows with SGR colour sequences; the row's text only exists once they are removed. */
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
/** Whole status-row labels followed by their values — never similarly named warning prose. */
const AUTH_ROW = /(?:^|\s)Auth\s+(\S.*)$/u;
const PROXY_ROW = /(?:^|\s)Proxy\s+(\S.*)$/u;
const SIGNED_OUT_MARKER = "not connected";
const PROXY_STOPPED_MARKER = "stopped";
const UNKNOWN_STATUS: JbcentralStatusObservation = { auth: "unknown", proxy: "unknown" };

/**
 * Read only closed negative observations from `central status`. Auth remains deliberately asymmetric: a
 * recognized row with any value besides the signed-out marker is connected. Proxy health is stricter — only
 * the exact stopped value creates a recovery demand; running and unfamiliar values remain non-demanding.
 */
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

/**
 * How long a caller may serve an observation before re-probing. Sized against the probe's cost, not against
 * how fast auth or proxy state can change: a burst of reads collapses to one child process.
 */
export const JBCENTRAL_STATUS_TTL_MS = 3_000;

/**
 * Probe auth and proxy health once. The output may contain private account/server details, so only the closed
 * observation escapes; raw output is never returned or logged.
 */
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
	if (action === "start-proxy") {
		const observation = await probeJbcentralStatus(deps);
		return observation.proxy === "stopped"
			? { outcome: "failed", reason: "proxy-stopped" }
			: { outcome: "succeeded", observation };
	}
	return { outcome: "succeeded" };
}

/**
 * Launch Central's browser sign-in without letting its output or errors reach callers.
 *
 * Spawning successfully is NOT evidence the flow started: `central login` drives its browser handoff from a
 * terminal UI, so without a TTY it exits immediately and no sign-in ever happens. The launch therefore waits
 * a grace period for an early non-zero exit and reports failure — a caller that trusted the spawn alone would
 * tell the user to finish in a browser that was never opened. A flow that really started is still running
 * when the grace elapses (it is waiting on the browser), and an "already signed in" short-circuit exits zero.
 */
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
		// Fold existence into the poll baseline so an event and its later poll can't double-report a transition.
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
