import { existsSync } from "node:fs";
import { link, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { JbcentralInstall } from "@thinkrail/contracts";
import { lock } from "proper-lockfile";

export type ParseEnv = Record<string, string | undefined>;

/** The only Central release whose native PI surface this build has reviewed and tested. */
export const REVIEWED_CENTRAL_VERSION = "1.6.2" as const;

const CENTRAL_BIN = "central";
const VERSION_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 120_000;
const UPDATE_TIMEOUT_MS = 300_000;
const MAX_VERSION_OUTPUT_BYTES = 4_096;

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

export interface JbcentralAdapterDependencies {
	env?: ParseEnv;
	which?: (command: string, path: string) => string | null;
	exists?: (path: string) => boolean;
	run?: (request: ProcessRequest) => Promise<ProcessResult>;
	launchDetached?: (argv: readonly string[]) => boolean;
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
	const executablePath = resolveJbcentralBin(deps);
	if (!executablePath) return { executablePath: null, extensionPath, status: { state: "absent" } };

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
			status: { state: "probe-failed", reason: "launch-failed" },
		};
	}
	if (result.outcome !== "exited") {
		return {
			executablePath,
			extensionPath,
			status: { state: "probe-failed", reason: result.outcome },
		};
	}
	if (result.exitCode !== 0) {
		return {
			executablePath,
			extensionPath,
			status: { state: "probe-failed", reason: "nonzero-exit" },
		};
	}

	const version = parseJbcentralVersion(result.stdout);
	if (!version) return { executablePath, extensionPath, status: { state: "malformed-version" } };

	const reviewed = parseJbcentralVersion(`central ${REVIEWED_CENTRAL_VERSION}`);
	if (!reviewed) throw new Error("invalid reviewed Central version constant");
	const comparison = compareVersions(version, reviewed);
	if (comparison < 0) {
		return { executablePath, extensionPath, status: { state: "outdated", version: version.text } };
	}
	if (comparison > 0) {
		return {
			executablePath,
			extensionPath,
			status: { state: "unreviewed", version: version.text },
		};
	}
	return {
		executablePath,
		extensionPath,
		status: {
			state: "supported",
			version: REVIEWED_CENTRAL_VERSION,
			configured: pathExists(extensionPath, deps),
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

const LEGACY_API_KEY = "wire-proxy";
const MAX_MODELS_WRITE_ATTEMPTS = 5;
const MODELS_LOCK_STALE_MS = 10_000;
const modelsFileLocks = new Map<string, Promise<void>>();

class ModelsFileLockConflictError extends Error {}

interface LegacyModelsCommitContext {
	operation: "cleanup" | "rollback";
	attempt: number;
	path: string;
}

export interface LegacyModelsDependencies {
	env?: ParseEnv;
	beforeCommit?: (context: LegacyModelsCommitContext) => Promise<void> | void;
	afterTargetClaimed?: (context: LegacyModelsCommitContext) => Promise<void> | void;
}

/** Opaque rollback capability. Legacy URLs remain only inside this module's in-memory WeakMap. */
export interface LegacyCleanupReceipt {
	readonly changedProviderCount: number;
}

export type LegacyCleanupResult =
	| { outcome: "unchanged" }
	| { outcome: "cleaned"; receipt: LegacyCleanupReceipt }
	| { outcome: "failed"; reason: "invalid-json" | "io-error" | "conflict" };

export type LegacyRollbackResult =
	| { outcome: "rolled-back"; restoredProviderCount: number }
	| {
			outcome: "partially-rolled-back";
			restoredProviderCount: number;
			skippedProviderCount: number;
	  }
	| { outcome: "unchanged"; skippedProviderCount: number }
	| { outcome: "failed"; reason: "invalid-receipt" | "invalid-json" | "io-error" | "conflict" };

type LegacyProviderId = "anthropic" | "openai";
interface LegacyFieldChange {
	providerId: LegacyProviderId;
	baseUrl: string;
	apiKey: typeof LEGACY_API_KEY;
}
interface InternalLegacyReceipt {
	path: string;
	changes: LegacyFieldChange[];
}
interface ModelsFileSnapshot {
	content: string;
	mode: number;
}

type JsonRecord = Record<string, unknown>;
const legacyReceipts = new WeakMap<LegacyCleanupReceipt, InternalLegacyReceipt>();

export function jbcentralModelsPath(env: ParseEnv = process.env): string {
	return join(
		env.PI_CODING_AGENT_DIR ?? join(env.HOME ?? homedir(), ".pi", "agent"),
		"models.json",
	);
}

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

function isJsonRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseModelsFile(content: string): JsonRecord | null {
	if (content.trim() === "") return {};
	const parsed: unknown = JSON.parse(content);
	return isJsonRecord(parsed) ? parsed : null;
}

function matchesLegacyBaseUrl(providerId: LegacyProviderId, value: unknown): value is string {
	if (typeof value !== "string") return false;
	const route = providerId === "anthropic" ? "pi/anthropic" : "pi/openai/v1";
	const match = new RegExp(
		`^http://127\\.0\\.0\\.1:(\\d{1,5})/wire/[^/?#\\s]+/${route}$`,
		"u",
	).exec(value);
	if (!match) return false;
	const port = Number(match[1]);
	return Number.isInteger(port) && port >= 0 && port <= 65_535;
}

function legacyChanges(config: JsonRecord): LegacyFieldChange[] {
	if (!isJsonRecord(config.providers)) return [];
	const changes: LegacyFieldChange[] = [];
	for (const providerId of ["anthropic", "openai"] as const) {
		const provider = config.providers[providerId];
		if (!isJsonRecord(provider)) continue;
		if (provider.apiKey !== LEGACY_API_KEY || !matchesLegacyBaseUrl(providerId, provider.baseUrl)) {
			continue;
		}
		changes.push({ providerId, baseUrl: provider.baseUrl, apiKey: LEGACY_API_KEY });
	}
	return changes;
}

function applyLegacyCleanup(config: JsonRecord, changes: readonly LegacyFieldChange[]): void {
	if (!isJsonRecord(config.providers)) return;
	for (const change of changes) {
		const provider = config.providers[change.providerId];
		if (!isJsonRecord(provider)) continue;
		if (provider.baseUrl !== change.baseUrl || provider.apiKey !== change.apiKey) continue;
		delete provider.baseUrl;
		delete provider.apiKey;
	}
}

function applyLegacyRollback(
	config: JsonRecord,
	changes: readonly LegacyFieldChange[],
): { restored: number; skipped: number } {
	if (!isJsonRecord(config.providers)) return { restored: 0, skipped: changes.length };
	let restored = 0;
	let skipped = 0;
	for (const change of changes) {
		const provider = config.providers[change.providerId];
		if (
			!isJsonRecord(provider) ||
			Object.hasOwn(provider, "baseUrl") ||
			Object.hasOwn(provider, "apiKey")
		) {
			skipped += 1;
			continue;
		}
		provider.baseUrl = change.baseUrl;
		provider.apiKey = change.apiKey;
		restored += 1;
	}
	return { restored, skipped };
}

async function readModelsSnapshot(path: string): Promise<ModelsFileSnapshot | null> {
	try {
		const [content, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
		return { content, mode: metadata.mode & 0o7777 };
	} catch (error) {
		if (errorCode(error) === "ENOENT") return null;
		throw error;
	}
}

async function syncParentDirectory(path: string): Promise<void> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(dirname(path), "r");
		await handle.sync();
	} catch {
		// Some platforms do not permit opening directories. The rename is still atomic there.
	} finally {
		await handle?.close();
	}
}

function modelsClaimPath(path: string): string {
	return join(dirname(path), `.${basename(path)}.thinkrail-claim`);
}

async function linkIfAbsent(source: string, target: string): Promise<"linked" | "occupied"> {
	try {
		await link(source, target);
		return "linked";
	} catch (error) {
		if (errorCode(error) === "EEXIST") return "occupied";
		throw error;
	}
}

async function recoverClaimedModelsTarget(path: string): Promise<void> {
	const claimPath = modelsClaimPath(path);
	if (!existsSync(claimPath)) return;
	await linkIfAbsent(claimPath, path);
	await syncParentDirectory(path);
	await unlink(claimPath);
}

async function atomicWriteIfUnchanged(
	path: string,
	expected: ModelsFileSnapshot,
	content: string,
	assertLock: () => void,
	afterTargetClaimed?: () => Promise<void> | void,
): Promise<"committed" | "conflict"> {
	const tempPath = join(
		dirname(path),
		`.${basename(path)}.thinkrail-${process.pid}-${crypto.randomUUID()}.tmp`,
	);
	const claimPath = modelsClaimPath(path);
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	let targetClaimed = false;
	let replacementPublished = false;
	try {
		handle = await open(tempPath, "wx", expected.mode);
		await handle.chmod(expected.mode);
		await handle.writeFile(content, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;

		assertLock();
		try {
			// Move whichever version currently owns the target path into our transaction claim. Unlike a
			// check-then-rename replacement, this preserves an uncoordinated writer that won the last race.
			await rename(path, claimPath);
			targetClaimed = true;
		} catch (error) {
			if (errorCode(error) === "ENOENT") return "conflict";
			throw error;
		}

		const claimed = await readModelsSnapshot(claimPath);
		if (!claimed || claimed.content !== expected.content || claimed.mode !== expected.mode) {
			return "conflict";
		}

		await afterTargetClaimed?.();
		assertLock();
		if ((await linkIfAbsent(tempPath, path)) === "occupied") return "conflict";
		replacementPublished = true;
		await syncParentDirectory(path);
		return "committed";
	} finally {
		await handle?.close();
		if (targetClaimed && !replacementPublished) {
			try {
				await linkIfAbsent(claimPath, path);
				await syncParentDirectory(path);
			} catch {
				// Keep the claim as a recovery journal when restoration itself fails.
				targetClaimed = false;
			}
		}
		try {
			await unlink(tempPath);
		} catch {
			// Best-effort temp cleanup must not overwrite the commit/conflict outcome.
		}
		if (targetClaimed) {
			try {
				await unlink(claimPath);
			} catch {
				// A stale claim is recovered under the same writer lock on the next transaction.
			}
		}
	}
}

async function withModelsFileLock<T>(
	path: string,
	operation: (assertLock: () => void) => Promise<T>,
): Promise<T> {
	const previous = modelsFileLocks.get(path) ?? Promise.resolve();
	let releaseInProcess: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		releaseInProcess = resolve;
	});
	const tail = previous.then(() => gate);
	modelsFileLocks.set(path, tail);
	await previous;

	let compromised = false;
	let releaseInterprocess: (() => Promise<void>) | undefined;
	try {
		releaseInterprocess = await lock(path, {
			realpath: false,
			stale: MODELS_LOCK_STALE_MS,
			update: MODELS_LOCK_STALE_MS / 4,
			retries: { retries: 20, factor: 1, minTimeout: 25, maxTimeout: 100, randomize: true },
			onCompromised: () => {
				compromised = true;
			},
		});
		const assertLock = (): void => {
			if (compromised) throw new ModelsFileLockConflictError();
		};
		assertLock();
		return await operation(assertLock);
	} finally {
		await releaseInterprocess?.().catch(() => undefined);
		releaseInProcess?.();
		if (modelsFileLocks.get(path) === tail) modelsFileLocks.delete(path);
	}
}

function modelsWriteFailure(error: unknown): "conflict" | "io-error" {
	return error instanceof ModelsFileLockConflictError || errorCode(error) === "ELOCKED"
		? "conflict"
		: "io-error";
}

/**
 * Remove only the exact field pairs written by ThinkRail's retired proxy integration. The operation
 * retries against concurrent edits, keeps unrelated JSON fields and file permissions, and never touches
 * the historical `.bak` file.
 */
export async function cleanupLegacyJbcentralModels(
	deps: LegacyModelsDependencies = {},
): Promise<LegacyCleanupResult> {
	const path = jbcentralModelsPath(deps.env ?? process.env);
	// Skipping an absent file is safe even if one appears immediately afterward: no stale snapshot is
	// published. A crash claim must still enter the lock so it can restore the target first.
	if (!existsSync(path) && !existsSync(modelsClaimPath(path))) return { outcome: "unchanged" };
	try {
		return await withModelsFileLock(path, async (assertLock) => {
			await recoverClaimedModelsTarget(path);
			for (let attempt = 1; attempt <= MAX_MODELS_WRITE_ATTEMPTS; attempt += 1) {
				let snapshot: ModelsFileSnapshot | null;
				let config: JsonRecord | null;
				try {
					assertLock();
					snapshot = await readModelsSnapshot(path);
					if (!snapshot) return { outcome: "unchanged" };
					config = parseModelsFile(snapshot.content);
				} catch (error) {
					return {
						outcome: "failed",
						reason: error instanceof SyntaxError ? "invalid-json" : modelsWriteFailure(error),
					};
				}
				if (!config) return { outcome: "unchanged" };
				const changes = legacyChanges(config);
				if (changes.length === 0) return { outcome: "unchanged" };
				applyLegacyCleanup(config, changes);
				const content = `${JSON.stringify(config, null, 2)}\n`;

				try {
					const context: LegacyModelsCommitContext = { operation: "cleanup", attempt, path };
					await deps.beforeCommit?.(context);
					if (
						(await atomicWriteIfUnchanged(path, snapshot, content, assertLock, () =>
							deps.afterTargetClaimed?.(context),
						)) === "conflict"
					) {
						continue;
					}
				} catch (error) {
					return { outcome: "failed", reason: modelsWriteFailure(error) };
				}

				const receipt: LegacyCleanupReceipt = { changedProviderCount: changes.length };
				legacyReceipts.set(receipt, { path, changes });
				return { outcome: "cleaned", receipt };
			}
			return { outcome: "failed", reason: "conflict" };
		});
	} catch (error) {
		return { outcome: "failed", reason: modelsWriteFailure(error) };
	}
}

/** Restore only this invocation's removed pairs when both fields still have the post-cleanup state. */
export async function rollbackLegacyJbcentralCleanup(
	receipt: LegacyCleanupReceipt,
	deps: LegacyModelsDependencies = {},
): Promise<LegacyRollbackResult> {
	const internal = legacyReceipts.get(receipt);
	if (!internal) return { outcome: "failed", reason: "invalid-receipt" };
	if (!existsSync(internal.path) && !existsSync(modelsClaimPath(internal.path))) {
		legacyReceipts.delete(receipt);
		return { outcome: "unchanged", skippedProviderCount: internal.changes.length };
	}

	try {
		return await withModelsFileLock(internal.path, async (assertLock) => {
			await recoverClaimedModelsTarget(internal.path);
			for (let attempt = 1; attempt <= MAX_MODELS_WRITE_ATTEMPTS; attempt += 1) {
				let snapshot: ModelsFileSnapshot | null;
				let config: JsonRecord | null;
				try {
					assertLock();
					snapshot = await readModelsSnapshot(internal.path);
					if (!snapshot) {
						legacyReceipts.delete(receipt);
						return { outcome: "unchanged", skippedProviderCount: internal.changes.length };
					}
					config = parseModelsFile(snapshot.content);
				} catch (error) {
					return {
						outcome: "failed",
						reason: error instanceof SyntaxError ? "invalid-json" : modelsWriteFailure(error),
					};
				}
				if (!config) {
					legacyReceipts.delete(receipt);
					return { outcome: "unchanged", skippedProviderCount: internal.changes.length };
				}
				const counts = applyLegacyRollback(config, internal.changes);
				if (counts.restored === 0) {
					legacyReceipts.delete(receipt);
					return { outcome: "unchanged", skippedProviderCount: counts.skipped };
				}
				const content = `${JSON.stringify(config, null, 2)}\n`;

				try {
					const context: LegacyModelsCommitContext = {
						operation: "rollback",
						attempt,
						path: internal.path,
					};
					await deps.beforeCommit?.(context);
					if (
						(await atomicWriteIfUnchanged(internal.path, snapshot, content, assertLock, () =>
							deps.afterTargetClaimed?.(context),
						)) === "conflict"
					) {
						continue;
					}
				} catch (error) {
					return { outcome: "failed", reason: modelsWriteFailure(error) };
				}

				legacyReceipts.delete(receipt);
				return counts.skipped === 0
					? { outcome: "rolled-back", restoredProviderCount: counts.restored }
					: {
							outcome: "partially-rolled-back",
							restoredProviderCount: counts.restored,
							skippedProviderCount: counts.skipped,
						};
			}
			return { outcome: "failed", reason: "conflict" };
		});
	} catch (error) {
		return { outcome: "failed", reason: modelsWriteFailure(error) };
	}
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
