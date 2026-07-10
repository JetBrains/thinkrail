// jbcentral (JetBrains Central CLI) wiring — the shared core behind BOTH `thinkrail jbcentral`
// (apps/cli) and the host's in-app JetBrains AI flow (packages/server/src/auth).
//
// It points pi's built-in `anthropic`/`openai` providers at the local jbcentral proxy by overriding
// their `baseUrl`/`apiKey` in `$PI_CODING_AGENT_DIR/models.json` — the built-ins keep their model
// lists (cost/context/thinking metadata); only the endpoint moves. The transforms are pure and
// unit-tested; only `wireJbcentralProxy` / the config readers touch IO (fs + the `jbcentral` spawn).

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** jbcentral strips agent-side credential headers, so any non-empty key works. */
const DUMMY_API_KEY = "wire-proxy";
/** Fallback proxy port when neither `WIRE_PROXY_PORT` nor `~/.wire/config.json` supplies one. */
const DEFAULT_PROXY_PORT = 19516;

/** The official installer one-liners (per the published install docs). */
export const JBCENTRAL_INSTALL_URL_SH =
	"https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/central/stable/install.sh";
export const JBCENTRAL_INSTALL_URL_PS1 =
	"https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/central/stable/install.ps1";

/** The exact install command for a platform — shown to the user before it runs, then executed verbatim. */
export function jbcentralInstallCommand(platform: NodeJS.Platform): {
	display: string;
	argv: string[];
} {
	if (platform === "win32") {
		const display = `irm ${JBCENTRAL_INSTALL_URL_PS1} | iex`;
		return { display, argv: ["powershell", "-NoProfile", "-Command", display] };
	}
	const display = `curl -fsSL ${JBCENTRAL_INSTALL_URL_SH} | bash`;
	return { display, argv: ["bash", "-lc", display] };
}

export type ParseEnv = Record<string, string | undefined>;

export type ProviderConfig = { baseUrl?: string; apiKey?: string } & Record<string, unknown>;
export type ModelsConfig = { providers?: Record<string, ProviderConfig> } & Record<string, unknown>;

/** Resolve the pi agent dir holding models.json (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`). */
export function resolveAgentDir(env: ParseEnv): string {
	return env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
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

export interface ProxyUrls {
	anthropicUrl: string;
	openaiUrl: string;
}

/**
 * Build the per-provider proxy base URLs. pi passes `model.baseUrl` straight to the official SDK, which
 * appends `/v1/messages` (anthropic) or `/responses` (openai); the proxy's per-provider PathSuffix injects
 * the backend `/v1/`. So no `/v1` here.
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

/** Does this models.json currently route anthropic/openai through a local jbcentral proxy? (pure) */
export function isJbcentralWired(config: ModelsConfig): boolean {
	const wired = (p?: ProviderConfig) =>
		typeof p?.baseUrl === "string" && /^http:\/\/127\.0\.0\.1:\d+\/wire\//.test(p.baseUrl);
	return wired(config.providers?.anthropic) || wired(config.providers?.openai);
}

/** Per-OS guidance shown when `jbcentral` isn't on PATH. */
export function jbcentralInstallHint(platform: NodeJS.Platform): string {
	if (platform === "win32") {
		return (
			"jbcentral not found on PATH. Install the JetBrains Central CLI for Windows (PowerShell):\n" +
			`  irm ${JBCENTRAL_INSTALL_URL_PS1} | iex\n` +
			"then re-run `thinkrail jbcentral`."
		);
	}
	return (
		"jbcentral not found on PATH. Install it with:\n" +
		`  curl -fsSL ${JBCENTRAL_INSTALL_URL_SH} | bash`
	);
}

/**
 * Find the `jbcentral` binary: PATH first, then the well-known install dirs (a freshly-installed CLI
 * may not be on the *host process's* PATH — the installer edits the user's shell rc, not ours).
 */
export function resolveJbcentralBin(): string | null {
	const onPath = Bun.which("jbcentral");
	if (onPath) return onPath;
	const exe = process.platform === "win32" ? "jbcentral.exe" : "jbcentral";
	const candidates = [
		join(homedir(), ".local", "bin", exe),
		join(homedir(), "bin", exe),
		"/usr/local/bin/jbcentral",
		"/opt/homebrew/bin/jbcentral",
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/** Read a JSON file, tolerating a missing/empty file (→ fallback). Throws on unparsable content. */
export async function readJsonConfig<T>(path: string, fallback: T): Promise<T> {
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

/** Back up the current models.json (`.bak`), then write the new one. */
export async function writeModelsWithBackup(path: string, config: ModelsConfig): Promise<void> {
	const file = Bun.file(path);
	if (await file.exists()) await Bun.write(`${path}.bak`, file);
	await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
}

export interface WireResult {
	port: number;
	urls: ProxyUrls;
	modelsJsonPath: string;
}

/**
 * Wire pi → the jbcentral proxy: ensure the proxy daemon is running (`jbcentral proxy start
 * --ensure-updated --return-key` — also our "are you logged in" probe: an empty/failed secret means
 * not logged in), resolve the port, and write the overrides into models.json (with a `.bak`).
 */
export async function wireJbcentralProxy(env: ParseEnv, bin?: string): Promise<WireResult> {
	const jbcentral = bin ?? resolveJbcentralBin();
	if (!jbcentral) throw new Error(jbcentralInstallHint(process.platform));

	const proxyStart = await Bun.$`${jbcentral} proxy start --ensure-updated --return-key`
		.quiet()
		.nothrow();
	if (proxyStart.exitCode !== 0) {
		throw new Error(`jbcentral proxy start failed:\n${proxyStart.stderr.toString().trim()}`);
	}
	const secret = proxyStart.stdout.toString().trim();
	if (secret === "") {
		throw new Error("jbcentral returned an empty secret. Are you logged in? Try: jbcentral login");
	}

	const wireConfig = await readJsonConfig<{ proxy_port?: number }>(
		join(homedir(), ".wire", "config.json"),
		{},
	);
	const port = resolveProxyPort(env, wireConfig);

	const agentDir = resolveAgentDir(env);
	const modelsJsonPath = join(agentDir, "models.json");
	await mkdir(agentDir, { recursive: true });
	const config = await readJsonConfig<ModelsConfig>(modelsJsonPath, {});
	const urls = buildProxyUrls(port, secret);
	applyJbcentralOverrides(config, urls);
	await writeModelsWithBackup(modelsJsonPath, config);
	return { port, urls, modelsJsonPath };
}

/** Undo `wireJbcentralProxy`: drop the managed overrides from models.json (with a `.bak`). */
export async function unwireJbcentralProxy(env: ParseEnv): Promise<{ modelsJsonPath: string }> {
	const agentDir = resolveAgentDir(env);
	const modelsJsonPath = join(agentDir, "models.json");
	const config = await readJsonConfig<ModelsConfig>(modelsJsonPath, {});
	removeJbcentralOverrides(config);
	await writeModelsWithBackup(modelsJsonPath, config);
	return { modelsJsonPath };
}
