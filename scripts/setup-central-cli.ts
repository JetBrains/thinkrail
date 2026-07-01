#!/usr/bin/env bun
// Point pi's model registry at the local JetBrains Central CLI proxy (`jbcentral`), so the pi agent behind
// thinkrail-pi talks to the JetBrains AI Platform using your JetBrains auth — the same path Claude Code and
// Codex use.
//
// Run this manually (it edits your real ~/.pi/agent/models.json), not from `bun run dev`:
//     bun setup-central-cli            # wire anthropic + openai at the proxy
//     bun setup-central-cli --remove   # undo (drop the baseUrl/apiKey we manage)
//
// It discovers the proxy secret + port from jbcentral and overrides the built-in `anthropic` and `openai`
// providers' baseUrl. Built-in providers keep their model lists (cost/context/thinking-level metadata) —
// only the endpoint moves to the proxy. Re-run any time to refresh a rotated secret/port.
//
// Env overrides: PI_CODING_AGENT_DIR (default ~/.pi/agent), WIRE_PROXY_PORT (default from ~/.wire/config.json).

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// jbcentral strips agent-side credential headers, so any non-empty key works.
const DUMMY_API_KEY = "wire-proxy";
const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const MODELS_JSON = join(AGENT_DIR, "models.json");
const WIRE_CONFIG = join(homedir(), ".wire", "config.json");

type ProviderConfig = { baseUrl?: string; apiKey?: string } & Record<string, unknown>;
type ModelsConfig = { providers?: Record<string, ProviderConfig> } & Record<string, unknown>;

function die(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
	const file = Bun.file(path);
	if (!(await file.exists())) return fallback;
	const text = (await file.text()).trim();
	if (text === "") return fallback;
	try {
		return JSON.parse(text) as T;
	} catch {
		die(`${path} is not valid JSON`);
	}
}

// Back up the current models.json, then write the new one.
async function writeModels(config: ModelsConfig): Promise<void> {
	const file = Bun.file(MODELS_JSON);
	if (await file.exists()) await Bun.write(`${MODELS_JSON}.bak`, file);
	await Bun.write(MODELS_JSON, `${JSON.stringify(config, null, 2)}\n`);
}

const args = process.argv.slice(2);
const remove = args[0] === "--remove";
if (args.length > 0 && !remove)
	die(`unknown argument '${args[0]}' (expected: --remove or nothing)`);

await mkdir(AGENT_DIR, { recursive: true });
const config = await readJson<ModelsConfig>(MODELS_JSON, {});
config.providers ??= {};

// --- Remove mode ---------------------------------------------------------------------------------
if (remove) {
	for (const id of ["anthropic", "openai"] as const) {
		const provider = config.providers[id];
		if (!provider) continue;
		delete provider.baseUrl;
		delete provider.apiKey;
		if (Object.keys(provider).length === 0) delete config.providers[id];
	}
	await writeModels(config);
	console.log(`Removed jbcentral overrides from ${MODELS_JSON} (backup: ${MODELS_JSON}.bak).`);
	console.log("The built-in anthropic/openai providers are back to their defaults.");
	process.exit(0);
}

// --- Discover the proxy --------------------------------------------------------------------------
if (!Bun.which("jbcentral")) {
	die(
		"jbcentral not found on PATH. Install it with:\n" +
			"  curl -fsSL https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/jbcentral/stable/install.sh | bash",
	);
}

// Ensures the proxy daemon is running and prints only the persistent secret.
const proxyStart = await Bun.$`jbcentral proxy start --ensure-updated --return-key`
	.quiet()
	.nothrow();
if (proxyStart.exitCode !== 0) {
	die(`jbcentral proxy start failed:\n${proxyStart.stderr.toString().trim()}`);
}
const secret = proxyStart.stdout.toString().trim();
if (secret === "")
	die("jbcentral returned an empty secret. Are you logged in? Try: jbcentral login");

// Port precedence: WIRE_PROXY_PORT env > ~/.wire/config.json proxy_port > 19516.
const wireConfig = await readJson<{ proxy_port?: number }>(WIRE_CONFIG, {});
const port = process.env.WIRE_PROXY_PORT ?? wireConfig.proxy_port ?? 19516;

const base = `http://127.0.0.1:${port}/wire/${secret}`;
const anthropicUrl = `${base}/claude-code/anthropic`;
const openaiUrl = `${base}/codex/openai`;

// --- Write the overrides -------------------------------------------------------------------------
// pi passes model.baseUrl straight to the official SDK, which appends /v1/messages (anthropic) or
// /responses (openai); the proxy's per-provider PathSuffix injects the backend /v1/. So no /v1 here.
config.providers.anthropic = {
	...config.providers.anthropic,
	baseUrl: anthropicUrl,
	apiKey: DUMMY_API_KEY,
};
config.providers.openai = { ...config.providers.openai, baseUrl: openaiUrl, apiKey: DUMMY_API_KEY };
await writeModels(config);

// --- Summary -------------------------------------------------------------------------------------
console.log(`Wired pi -> JetBrains Central CLI proxy (port ${port}).`);
console.log(`  config:    ${MODELS_JSON}  (backup: ${MODELS_JSON}.bak)`);
console.log(`  anthropic: ${anthropicUrl}`);
console.log(`  openai:    ${openaiUrl}`);
console.log();
console.log(
	"The built-in Anthropic (Claude) and OpenAI (GPT) model picks in pi / thinkrail-pi now route",
);
console.log(
	"through JetBrains AI. Note: direct provider access is shadowed while these overrides are set,",
);
console.log(
	"and the picker may list models JetBrains AI doesn't serve. Undo with: bun setup-central-cli --remove",
);
