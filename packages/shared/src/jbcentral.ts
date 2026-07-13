// The JetBrains Central CLI (`jbcentral`) proxy integration — the single home for its wire, pinned here so
// the **write** side (build the proxy `baseUrl`s + override `models.json`) and the **read** side
// (`isJbcentralProxyUrl`, how the server detects a wired provider) can never silently diverge. The server's
// in-app "Connect JetBrains AI" flow is a thin caller over `wireJbcentral`/`unwireJbcentral`, adding only its
// own follow-up (refresh the live model registry). Server-side only (shells out + touches
// `~/.pi/agent/models.json`).

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JbcentralInstall } from "@thinkrail/contracts";

/** jbcentral strips agent-side credential headers, so any non-empty key works. */
export const DUMMY_API_KEY = "wire-proxy";
/** Fallback proxy port when neither `WIRE_PROXY_PORT` nor `~/.wire/config.json` supplies one. */
export const DEFAULT_PROXY_PORT = 19516;

export type ParseEnv = Record<string, string | undefined>;
export type ProviderConfig = { baseUrl?: string; apiKey?: string } & Record<string, unknown>;
export type ModelsConfig = { providers?: Record<string, ProviderConfig> } & Record<string, unknown>;
export interface ProxyUrls {
	anthropicUrl: string;
	openaiUrl: string;
}

/** A never-empty error message (an `error` outcome must always carry something the UI can show). */
function errorMessage(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	return msg.trim() || "jbcentral wiring failed";
}

/**
 * Whether a provider `baseUrl` is a jbcentral-managed proxy URL: a loopback host with a `/wire/…` path.
 * Tolerant of `undefined`/malformed input (returns `false`) — callers feed it raw registry state.
 */
export function isJbcentralProxyUrl(url: string | undefined): boolean {
	if (!url) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	const loopback =
		parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
	return loopback && parsed.pathname.startsWith("/wire/");
}

/** Resolve the proxy port: `WIRE_PROXY_PORT` env > `~/.wire/config.json` proxy_port > default. Throws on a bad env value. */
export function resolveProxyPort(env: ParseEnv, wireConfig: { proxy_port?: number }): number {
	const fromEnv = env.WIRE_PROXY_PORT;
	if (fromEnv !== undefined && fromEnv !== "") {
		const parsed = Number(fromEnv);
		if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
			throw new Error(`Invalid WIRE_PROXY_PORT: ${fromEnv}`);
		}
		return parsed;
	}
	if (typeof wireConfig.proxy_port === "number") return wireConfig.proxy_port;
	return DEFAULT_PROXY_PORT;
}

/**
 * Build the per-provider proxy base URLs. pi passes `model.baseUrl` straight to the official SDK, which
 * appends `/v1/messages` (anthropic) or `/responses` (openai); the proxy's per-provider PathSuffix injects
 * the backend `/v1/`. So no `/v1` here. The **shape here is what `isJbcentralProxyUrl` reads** — keep in sync.
 */
export function buildProxyUrls(port: number, secret: string): ProxyUrls {
	const base = `http://127.0.0.1:${port}/wire/${secret}`;
	return { anthropicUrl: `${base}/claude-code/anthropic`, openaiUrl: `${base}/codex/openai` };
}

/** Wire the anthropic + openai providers' baseUrl/apiKey to the proxy, preserving their other fields. Mutates + returns `config`. */
export function applyJbcentralOverrides(config: ModelsConfig, urls: ProxyUrls): ModelsConfig {
	config.providers ??= {};
	config.providers.anthropic = {
		...config.providers.anthropic,
		baseUrl: urls.anthropicUrl,
		apiKey: DUMMY_API_KEY,
	};
	config.providers.openai = {
		...config.providers.openai,
		baseUrl: urls.openaiUrl,
		apiKey: DUMMY_API_KEY,
	};
	return config;
}

/** Drop the baseUrl/apiKey we manage from anthropic + openai (removing a provider entry left empty). Mutates + returns `config`. */
export function removeJbcentralOverrides(config: ModelsConfig): ModelsConfig {
	if (!config.providers) return config;
	for (const id of ["anthropic", "openai"] as const) {
		const provider = config.providers[id];
		if (!provider) continue;
		delete provider.baseUrl;
		delete provider.apiKey;
		if (Object.keys(provider).length === 0) delete config.providers[id];
	}
	return config;
}

/**
 * The S3 `stable` channel that hosts the JetBrains Central CLI install scripts. Note the path is `central/`
 * (the tool rebranded jbcentral → central; the bucket path moved with it), not the old `jbcentral/`.
 */
const JBCENTRAL_INSTALL_BASE =
	"https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/central/stable";

/**
 * The per-OS install command for the JetBrains Central CLI (`central`) on a given host platform — the
 * **single source of truth** for the install one-liner. Composed into the CLI's needs-install message
 * (`jbcentralInstallHint`) and carried over the wire (`ProviderStatusReport.jbcentralInstall`) for the
 * in-app JetBrains AI card, so the two can never diverge. macOS/Linux → the `install.sh` curl pipe;
 * Windows → the PowerShell `install.ps1` one-liner.
 */
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

/** Per-OS guidance shown (in the CLI console) when `central` isn't on PATH — composes the same command
 * `jbcentralInstall` produces, so the CLI hint and the in-app card never drift. */
export function jbcentralInstallHint(platform: NodeJS.Platform): string {
	return `The JetBrains Central CLI (central) isn't installed. Install it with:\n  ${jbcentralInstall(platform).command}`;
}

/**
 * Candidate binary names, in preference order. The CLI rebranded **jbcentral → central** (v1.x): a fresh
 * install ships only `central`, with `jbcentral` created merely as a legacy-compat symlink when upgrading.
 */
const JBCENTRAL_BINS = ["central", "jbcentral"] as const;

/**
 * Resolve the JetBrains Central CLI binary to an absolute path, or `null` if it isn't installed. Subtleties
 * this exists for (each caused the "installed but Recheck does nothing" bug):
 *   1. the tool is now named `central`, not `jbcentral` (see above) — check both.
 *   2. `Bun.which(cmd)` with no options reads the PATH **snapshotted at process start**, not the live
 *      `process.env.PATH` — so we pass `process.env.PATH` explicitly (honors a re-resolved login PATH).
 *   3. the installer drops it in `~/.local/bin` and does NOT add that to PATH (it only prints a hint) — so
 *      we fall back to that well-known location.
 * Invoking by this absolute path also means the proxy/login calls work even when it's off PATH.
 */
export function resolveJbcentralBin(): string | null {
	const path = process.env.PATH ?? "";
	const home = process.env.HOME ?? homedir();
	for (const name of JBCENTRAL_BINS) {
		const onPath = Bun.which(name, { PATH: path });
		if (onPath) return onPath;
		const local = join(home, ".local", "bin", name);
		if (existsSync(local)) return local;
	}
	return null;
}

/** Whether the JetBrains Central CLI is installed (`central`/`jbcentral` on the live PATH or `~/.local/bin`). */
export function isJbcentralInstalled(): boolean {
	return resolveJbcentralBin() !== null;
}

/** The pi agent dir's models.json path (`PI_CODING_AGENT_DIR` or `~/.pi/agent`). */
export function jbcentralModelsPath(env: ParseEnv): string {
	const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return join(agentDir, "models.json");
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
	const file = Bun.file(path);
	if (!(await file.exists())) return fallback;
	const text = (await file.text()).trim();
	if (text === "") return fallback;
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`${path} is not valid JSON`);
	}
}

/** Back up the ORIGINAL models.json to `.bak` (once), then write the new one. */
async function writeModels(path: string, config: ModelsConfig): Promise<void> {
	const file = Bun.file(path);
	// Only back up when no `.bak` exists yet — otherwise a connect→disconnect→connect cycle would overwrite
	// the user's real (pre-jbcentral) models.json backup with an intermediate managed state.
	if ((await file.exists()) && !(await Bun.file(`${path}.bak`).exists())) {
		await Bun.write(`${path}.bak`, file);
	}
	await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
}

/** Probe result: the persistent proxy secret, or *why* it's unavailable. */
export type SecretProbe =
	| { ok: true; secret: string }
	| { ok: false; reason: "not-installed" | "not-logged-in" | "error"; message?: string };

/**
 * Ensure the proxy daemon is running and return its persistent secret. An empty secret means the user isn't
 * signed into JetBrains AI (`jbcentral login`); a non-zero exit is a hard error (surfaced verbatim).
 */
export async function probeJbcentralSecret(): Promise<SecretProbe> {
	const bin = resolveJbcentralBin();
	if (!bin) return { ok: false, reason: "not-installed" };
	// `central proxy start --return-key` starts the daemon and prints only the persistent secret. (The old
	// `jbcentral` also accepted `--ensure-updated`; `central` removed it, and `--return-key` alone suffices.)
	const proxyStart = await Bun.$`${bin} proxy start --return-key`.quiet().nothrow();
	if (proxyStart.exitCode !== 0) {
		return { ok: false, reason: "error", message: proxyStart.stderr.toString().trim() };
	}
	const secret = proxyStart.stdout.toString().trim();
	if (secret === "") return { ok: false, reason: "not-logged-in" };
	return { ok: true, secret };
}

/** Resolve the effective proxy port from env + `~/.wire/config.json`. */
export async function resolveWirePort(env: ParseEnv): Promise<number> {
	const wireConfig = await readJson<{ proxy_port?: number }>(
		join(homedir(), ".wire", "config.json"),
		{},
	);
	return resolveProxyPort(env, wireConfig);
}

/** The outcome of an attempted wire — a small state machine the CLI + the in-app card both render. */
export type WireOutcome =
	| { outcome: "connected"; port: number; urls: ProxyUrls }
	| { outcome: "needs-install"; hint: string }
	| { outcome: "needs-login" }
	| { outcome: "error"; message: string };

/**
 * Wire pi's `anthropic`/`openai` providers through the jbcentral proxy: probe the secret, resolve the port,
 * and override `models.json` (backing it up). Does NOT refresh a live registry or log — the caller adds that.
 */
export async function wireJbcentral(env: ParseEnv): Promise<WireOutcome> {
	const probe = await probeJbcentralSecret();
	if (!probe.ok) {
		if (probe.reason === "not-installed") {
			return { outcome: "needs-install", hint: jbcentralInstallHint(process.platform) };
		}
		if (probe.reason === "not-logged-in") return { outcome: "needs-login" };
		return { outcome: "error", message: probe.message || "jbcentral proxy start failed" };
	}
	let port: number;
	try {
		port = await resolveWirePort(env);
	} catch (err) {
		return { outcome: "error", message: errorMessage(err) };
	}
	const path = jbcentralModelsPath(env);
	let config: ModelsConfig;
	try {
		config = await readJson<ModelsConfig>(path, {});
	} catch (err) {
		return { outcome: "error", message: errorMessage(err) };
	}
	const urls = buildProxyUrls(port, probe.secret);
	applyJbcentralOverrides(config, urls);
	await mkdir(join(path, ".."), { recursive: true });
	await writeModels(path, config);
	return { outcome: "connected", port, urls };
}

/** Undo the jbcentral overrides in `models.json` (backing it up). Does NOT refresh a live registry. */
export async function unwireJbcentral(env: ParseEnv): Promise<void> {
	const path = jbcentralModelsPath(env);
	const config = await readJson<ModelsConfig>(path, {});
	removeJbcentralOverrides(config);
	await writeModels(path, config);
}

/**
 * Best-effort launch of `jbcentral login` (its browser sign-in) as a detached child — non-blocking. Returns
 * whether it started; if `jbcentral` needs a TTY and refuses, the caller falls back to terminal guidance.
 */
export function launchJbcentralLogin(): { launched: boolean; message?: string } {
	const bin = resolveJbcentralBin();
	if (!bin) return { launched: false, message: "jbcentral is not installed" };
	try {
		// Invoke by absolute path (it may be off PATH, e.g. ~/.local/bin); `.unref()` so the browser sign-in
		// child doesn't keep the host's event loop alive (it outlives this call).
		Bun.spawn([bin, "login"], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		}).unref();
		return { launched: true };
	} catch (err) {
		return { launched: false, message: err instanceof Error ? err.message : String(err) };
	}
}
