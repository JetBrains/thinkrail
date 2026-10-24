import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DetectedAccount } from "@thinkrail/contracts";

export interface DetectModelsOptions {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	platform?: NodeJS.Platform;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<Json | null> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function plan(value: unknown): { plan?: string } {
	return typeof value === "string" && value.trim() ? { plan: value.trim() } : {};
}

function jwtClaims(token: unknown): Json | null {
	if (typeof token !== "string") return null;
	const payload = token.split(".")[1];
	if (!payload) return null;
	try {
		const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

async function detectClaudeCode(
	env: NodeJS.ProcessEnv,
	home: string,
): Promise<DetectedAccount | null> {
	const configured = env.CLAUDE_CONFIG_DIR?.trim();
	const configDir = configured || join(home, ".claude");
	const [credentials, config] = await Promise.all([
		readJson(join(configDir, ".credentials.json")),
		readJson(configured ? join(configDir, ".claude.json") : join(home, ".claude.json")),
	]);
	const oauth = credentials?.claudeAiOauth;
	if (!isObject(oauth) && !isObject(config?.oauthAccount)) return null;
	return {
		providerId: "anthropic",
		source: "claude-code",
		...plan(isObject(oauth) ? oauth.subscriptionType : undefined),
	};
}

async function detectCodex(env: NodeJS.ProcessEnv, home: string): Promise<DetectedAccount | null> {
	const auth = await readJson(join(env.CODEX_HOME?.trim() || join(home, ".codex"), "auth.json"));
	const tokens = auth?.tokens;
	if (!isObject(tokens) && auth?.auth_mode !== "chatgpt") return null;
	const claims = jwtClaims(isObject(tokens) ? tokens.id_token : undefined);
	const openai = claims?.["https://api.openai.com/auth"];
	return {
		providerId: "openai-codex",
		source: "codex",
		...plan(isObject(openai) ? openai.chatgpt_plan_type : undefined),
	};
}

async function detectCopilot(
	env: NodeJS.ProcessEnv,
	home: string,
	platform: NodeJS.Platform,
): Promise<DetectedAccount | null> {
	const base =
		platform === "win32"
			? env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local")
			: env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
	const dir = join(base, "github-copilot");
	const files = await Promise.all([
		readJson(join(dir, "apps.json")),
		readJson(join(dir, "hosts.json")),
	]);
	if (!files.some((file) => file && Object.keys(file).length > 0)) return null;
	return { providerId: "github-copilot", source: "github-copilot" };
}

export async function detectModels(options: DetectModelsOptions = {}): Promise<DetectedAccount[]> {
	const env = options.env ?? process.env;
	const home = options.homeDir ?? (env.HOME?.trim() || homedir());
	const platform = options.platform ?? process.platform;
	const found = await Promise.all([
		detectClaudeCode(env, home),
		detectCodex(env, home),
		detectCopilot(env, home, platform),
	]);
	return found.filter((account) => account !== null);
}
