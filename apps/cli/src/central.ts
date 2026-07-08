// `thinkrail central` — point pi's model registry at the local JetBrains Central CLI proxy (`jbcentral`),
// so the pi agent behind thinkrail talks to the JetBrains AI Platform using your JetBrains auth (the same
// path Claude Code and Codex use). Ported into the CLI so it ships **inside the compiled binary** — the
// binary already carries a full Bun runtime, so `thinkrail central` works on mac/linux/windows with no
// preinstalled bun. `scripts/setup-central-cli.ts` is now a thin wrapper over `runCentral`.
//
// It discovers the proxy secret + port from `jbcentral` and overrides the built-in `anthropic`/`openai`
// providers' baseUrl. Built-in providers keep their model lists (cost/context/thinking-level metadata) —
// only the endpoint moves to the proxy. Re-run any time to refresh a rotated secret/port.
//
// The arg parse + config transforms are pure (unit-tested); only fs + the `jbcentral` invocation touch IO.

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** jbcentral strips agent-side credential headers, so any non-empty key works. */
const DUMMY_API_KEY = "wire-proxy";
/** Fallback proxy port when neither `WIRE_PROXY_PORT` nor `~/.wire/config.json` supplies one. */
const DEFAULT_PROXY_PORT = 19516;

export const CENTRAL_USAGE = `Usage: thinkrail central [--remove]

Wire pi's model registry through the local JetBrains Central CLI (jbcentral) proxy, so the
built-in Claude (anthropic) and GPT (openai) model picks route through your JetBrains AI auth.
Re-run any time to refresh a rotated secret/port.

Options:
  --remove       Undo: drop the baseUrl/apiKey overrides we manage.
  -h, --help     Show this help.

Env:
  PI_CODING_AGENT_DIR   pi agent dir holding models.json (default ~/.pi/agent).
  WIRE_PROXY_PORT       Proxy port (default: ~/.wire/config.json proxy_port, else ${DEFAULT_PROXY_PORT}).`;

export type ParseEnv = Record<string, string | undefined>;

export type ProviderConfig = { baseUrl?: string; apiKey?: string } & Record<string, unknown>;
export type ModelsConfig = { providers?: Record<string, ProviderConfig> } & Record<string, unknown>;

export interface CentralArgs {
	/** `--remove` was passed — undo the overrides instead of wiring them. */
	remove: boolean;
	/** `-h`/`--help` was passed — print usage and exit. */
	help: boolean;
}

/** Parse `central`'s argv (the slice after `central`). Throws on an unknown flag. */
export function parseCentralArgs(argv: readonly string[]): CentralArgs {
	let remove = false;
	let help = false;
	for (const arg of argv) {
		if (arg === "--remove") remove = true;
		else if (arg === "-h" || arg === "--help") help = true;
		else throw new Error(`Unknown option: ${arg}`);
	}
	return { remove, help };
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
export function applyCentralOverrides(config: ModelsConfig, urls: ProxyUrls): ModelsConfig {
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
export function removeCentralOverrides(config: ModelsConfig): ModelsConfig {
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

/** Per-OS guidance shown when `jbcentral` isn't on PATH. */
export function centralInstallHint(platform: NodeJS.Platform): string {
	if (platform === "win32") {
		return (
			"jbcentral not found on PATH. Install the JetBrains Central CLI for Windows, then re-run\n" +
			"`thinkrail central`. See your JetBrains AI / Central CLI setup docs for the Windows installer."
		);
	}
	return (
		"jbcentral not found on PATH. Install it with:\n" +
		"  curl -fsSL https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/jbcentral/stable/install.sh | bash"
	);
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

/** Back up the current models.json (`.bak`), then write the new one. */
async function writeModels(path: string, config: ModelsConfig): Promise<void> {
	const file = Bun.file(path);
	if (await file.exists()) await Bun.write(`${path}.bak`, file);
	await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
}

/** Run the `central` subcommand. Returns a process exit code. */
export async function runCentral(argv: readonly string[], env: ParseEnv): Promise<number> {
	let parsed: CentralArgs;
	try {
		parsed = parseCentralArgs(argv);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${CENTRAL_USAGE}`);
		return 1;
	}
	if (parsed.help) {
		console.log(CENTRAL_USAGE);
		return 0;
	}

	const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	const modelsJson = join(agentDir, "models.json");
	const wireConfigPath = join(homedir(), ".wire", "config.json");

	await mkdir(agentDir, { recursive: true });
	let config: ModelsConfig;
	try {
		config = await readJson<ModelsConfig>(modelsJson, {});
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}

	// --- Remove mode -----------------------------------------------------------------------------
	if (parsed.remove) {
		removeCentralOverrides(config);
		await writeModels(modelsJson, config);
		console.log(`Removed jbcentral overrides from ${modelsJson} (backup: ${modelsJson}.bak).`);
		console.log("The built-in anthropic/openai providers are back to their defaults.");
		return 0;
	}

	// --- Discover the proxy ----------------------------------------------------------------------
	if (!Bun.which("jbcentral")) {
		console.error(centralInstallHint(process.platform));
		return 1;
	}

	// Ensures the proxy daemon is running and prints only the persistent secret.
	const proxyStart = await Bun.$`jbcentral proxy start --ensure-updated --return-key`
		.quiet()
		.nothrow();
	if (proxyStart.exitCode !== 0) {
		console.error(`jbcentral proxy start failed:\n${proxyStart.stderr.toString().trim()}`);
		return 1;
	}
	const secret = proxyStart.stdout.toString().trim();
	if (secret === "") {
		console.error("jbcentral returned an empty secret. Are you logged in? Try: jbcentral login");
		return 1;
	}

	let port: number;
	try {
		const wireConfig = await readJson<{ proxy_port?: number }>(wireConfigPath, {});
		port = resolveProxyPort(env, wireConfig);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		return 1;
	}

	// --- Write the overrides ---------------------------------------------------------------------
	const urls = buildProxyUrls(port, secret);
	applyCentralOverrides(config, urls);
	await writeModels(modelsJson, config);

	// --- Summary ---------------------------------------------------------------------------------
	console.log(`Wired pi -> JetBrains Central CLI proxy (port ${port}).`);
	console.log(`  config:    ${modelsJson}  (backup: ${modelsJson}.bak)`);
	console.log(`  anthropic: ${urls.anthropicUrl}`);
	console.log(`  openai:    ${urls.openaiUrl}`);
	console.log();
	console.log(
		"The built-in Anthropic (Claude) and OpenAI (GPT) model picks in pi / thinkrail now route",
	);
	console.log(
		"through JetBrains AI. Note: direct provider access is shadowed while these overrides are set,",
	);
	console.log(
		"and the picker may list models JetBrains AI doesn't serve. Undo with: thinkrail central --remove",
	);
	return 0;
}
