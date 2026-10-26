import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { DetectedAccount, DetectedAccountSource } from "@thinkrail/contracts";
import { usePiRuntime } from "../agent";

export interface DetectAccountsOptions {
	env?: NodeJS.ProcessEnv;
	homeDir?: string;
	platform?: NodeJS.Platform;
	now?: number;
}

export interface AccountSignal {
	source: DetectedAccountSource;
	providerIds: readonly string[];
	plan?: string;
}

type Json = Record<string, unknown>;

const MAX_CONFIG_BYTES = 1024 * 1024;

const CLAUDE_SUBSCRIPTION_BILLING = new Set([
	"stripe_subscription",
	"stripe_subscription_contracted",
	"stripe_subscription_enterprise_self_serve",
	"aws_marketplace",
	"c4e_consumption_trial",
	"apple_subscription",
	"google_play_subscription",
]);

const GROK_API_KEY_SCOPE = "xai::api_key";

function isObject(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filled(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function envPath(env: NodeJS.ProcessEnv, name: string): string | undefined {
	const value = env[name]?.trim();
	return value ? value : undefined;
}

async function readConfig(path: string): Promise<string | null> {
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size > MAX_CONFIG_BYTES) return null;
		return (await readFile(path, "utf8")).replace(/^﻿/, "");
	} catch {
		return null;
	}
}

async function readJson(path: string): Promise<Json | null> {
	const text = await readConfig(path);
	if (text === null) return null;
	try {
		const parsed: unknown = JSON.parse(text.replace(/^(?:\s*\/\/[^\n]*\n)+/, ""));
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function plan(value: unknown): { plan?: string } {
	return filled(value) ? { plan: value.trim() } : {};
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

function expiresAfter(value: unknown, now: number): boolean {
	const at =
		typeof value === "number"
			? value < 1e12
				? value * 1000
				: value
			: typeof value === "string"
				? Date.parse(value)
				: Number.NaN;
	return at > now;
}

async function detectClaudeCode(
	env: NodeJS.ProcessEnv,
	home: string,
): Promise<AccountSignal | null> {
	const signal = (extra: { plan?: string } = {}): AccountSignal => ({
		source: "claude-code",
		providerIds: ["anthropic"],
		...extra,
	});
	if (filled(env.CLAUDE_CODE_OAUTH_TOKEN)) return signal();

	const configured = envPath(env, "CLAUDE_CONFIG_DIR");
	const configDir = configured ?? join(home, ".claude");
	const secureDir = envPath(env, "CLAUDE_SECURESTORAGE_CONFIG_DIR") ?? configDir;
	const [legacy, global, credentials] = await Promise.all([
		readJson(join(configDir, ".config.json")),
		readJson(join(configured ?? home, ".claude.json")),
		readJson(join(secureDir, ".credentials.json")),
	]);
	const oauth = credentials?.claudeAiOauth;
	if (isObject(oauth)) {
		const scopes = Array.isArray(oauth.scopes) ? oauth.scopes : [];
		return filled(oauth.refreshToken) && scopes.includes("user:inference")
			? signal(plan(oauth.subscriptionType))
			: null;
	}
	const config = legacy && Object.keys(legacy).length > 0 ? legacy : global;
	const account = config?.oauthAccount;
	if (!isObject(account) || !filled(account.accountUuid)) return null;
	return typeof account.billingType === "string" &&
		CLAUDE_SUBSCRIPTION_BILLING.has(account.billingType)
		? signal()
		: null;
}

function codexMode(auth: Json): unknown {
	if (auth.auth_mode !== undefined) return auth.auth_mode;
	if (
		filled(auth.personal_access_token) ||
		auth.bedrock_api_key != null ||
		auth.bedrock_access_keys != null ||
		filled(auth.OPENAI_API_KEY)
	) {
		return "apikey";
	}
	return "chatgpt";
}

async function detectCodex(env: NodeJS.ProcessEnv, home: string): Promise<AccountSignal | null> {
	const auth = await readJson(
		join(envPath(env, "CODEX_HOME") ?? join(home, ".codex"), "auth.json"),
	);
	if (!auth || codexMode(auth) !== "chatgpt") return null;
	const tokens = auth.tokens;
	if (!isObject(tokens) || !filled(tokens.refresh_token)) return null;
	const openai = jwtClaims(tokens.id_token)?.["https://api.openai.com/auth"];
	return {
		source: "codex",
		providerIds: ["openai", "openai-codex"],
		...plan(isObject(openai) ? openai.chatgpt_plan_type : undefined),
	};
}

async function detectCopilotEditor(
	env: NodeJS.ProcessEnv,
	home: string,
	platform: NodeJS.Platform,
): Promise<AccountSignal | null> {
	const xdg = envPath(env, "XDG_CONFIG_HOME");
	const base =
		xdg && isAbsolute(xdg)
			? xdg
			: platform === "win32"
				? join(home, "AppData", "Local")
				: join(home, ".config");
	const dir = join(base, "github-copilot");
	const files = await Promise.all([
		readJson(join(dir, "apps.json")),
		readJson(join(dir, "hosts.json")),
	]);
	const signedIn = files.some(
		(file) =>
			file !== null &&
			Object.values(file).some(
				(entry) => isObject(entry) && (filled(entry.user) || filled(entry.oauth_token)),
			),
	);
	return signedIn ? { source: "github-copilot", providerIds: ["github-copilot"] } : null;
}

async function detectCopilotCli(
	env: NodeJS.ProcessEnv,
	home: string,
): Promise<AccountSignal | null> {
	const config = await readJson(
		join(envPath(env, "COPILOT_HOME") ?? join(home, ".copilot"), "config.json"),
	);
	const users = config?.loggedInUsers;
	const signedIn =
		Array.isArray(users) && users.some((user) => isObject(user) && filled(user.login));
	return signedIn ? { source: "copilot-cli", providerIds: ["github-copilot"] } : null;
}

async function detectKimiCli(env: NodeJS.ProcessEnv, home: string): Promise<AccountSignal | null> {
	const share = envPath(env, "KIMI_SHARE_DIR") ?? join(home, ".kimi");
	const token = await readJson(join(share, "credentials", "kimi-code.json"));
	return token && filled(token.refresh_token)
		? { source: "kimi-cli", providerIds: ["kimi-coding"] }
		: null;
}

async function detectGrokBuild(
	env: NodeJS.ProcessEnv,
	home: string,
	now: number,
): Promise<AccountSignal | null> {
	const path =
		envPath(env, "GROK_AUTH_PATH") ??
		join(envPath(env, "GROK_HOME") ?? join(home, ".grok"), "auth.json");
	const auth = await readJson(path);
	if (!auth) return null;
	const signedIn = Object.entries(auth).some(
		([scope, entry]) =>
			scope !== GROK_API_KEY_SCOPE &&
			isObject(entry) &&
			entry.auth_mode !== "api_key" &&
			(filled(entry.refresh_token) || expiresAfter(entry.expires_at, now)),
	);
	return signedIn ? { source: "grok-build", providerIds: ["xai"] } : null;
}

export async function detectAccountSignals(
	options: DetectAccountsOptions = {},
): Promise<AccountSignal[]> {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const home =
		options.homeDir ?? envPath(env, platform === "win32" ? "USERPROFILE" : "HOME") ?? homedir();
	const now = options.now ?? Date.now();
	const found = await Promise.all([
		detectClaudeCode(env, home),
		detectCodex(env, home),
		detectCopilotEditor(env, home, platform),
		detectCopilotCli(env, home),
		detectKimiCli(env, home),
		detectGrokBuild(env, home, now),
	]);
	return found.filter((signal) => signal !== null);
}

export function resolveDetectedAccounts(
	signals: readonly AccountSignal[],
	canOAuth: (providerId: string) => boolean,
): DetectedAccount[] {
	const seen = new Set<string>();
	return signals.flatMap((signal): DetectedAccount[] => {
		const providerId = signal.providerIds.find(canOAuth);
		if (!providerId || seen.has(providerId)) return [];
		seen.add(providerId);
		return [
			{
				providerId,
				source: signal.source,
				...(signal.plan === undefined ? {} : { plan: signal.plan }),
			},
		];
	});
}

export async function detectAccounts(
	options: DetectAccountsOptions = {},
): Promise<DetectedAccount[]> {
	const signals = await detectAccountSignals(options);
	if (signals.length === 0) return [];
	return usePiRuntime((runtime) =>
		resolveDetectedAccounts(signals, (id) => Boolean(runtime.getProvider(id)?.auth.oauth)),
	);
}
