import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type AccountSignal,
	detectAccountSignals,
	resolveDetectedAccounts,
} from "./detectAccounts";

const NOW = Date.parse("2026-10-26T12:00:00Z");

let home: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "trpi-detect-"));
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

function put(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
}

function idToken(claims: unknown): string {
	return `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
}

const detect = (env: NodeJS.ProcessEnv = {}, platform: NodeJS.Platform = "darwin") =>
	detectAccountSignals({ env, homeDir: home, platform, now: NOW });

const sources = async (env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform) =>
	(await detect(env, platform)).map((signal) => signal.source);

test("an empty home detects nothing", async () => {
	expect(await detect()).toEqual([]);
});

describe("Claude Code", () => {
	const credentials = () => join(home, ".claude", ".credentials.json");
	const subscription = {
		claudeAiOauth: {
			accessToken: "secret",
			refreshToken: "secret",
			scopes: ["user:inference", "user:profile"],
			subscriptionType: "max",
		},
	};

	test("a claude.ai credential with the inference scope yields its plan", async () => {
		put(credentials(), subscription);
		expect(await detect()).toEqual([
			{ source: "claude-code", providerIds: ["anthropic"], plan: "max" },
		]);
	});

	test("an expired access token with a live refresh token is still signed in", async () => {
		put(credentials(), {
			claudeAiOauth: { ...subscription.claudeAiOauth, accessToken: "", expiresAt: 0 },
		});
		expect(await sources()).toEqual(["claude-code"]);
	});

	test("a Console login without the inference scope is not a subscription", async () => {
		put(credentials(), {
			claudeAiOauth: { refreshToken: "secret", scopes: ["org:create_api_key", "user:profile"] },
		});
		put(join(home, ".claude.json"), {
			oauthAccount: { accountUuid: "u", billingType: "stripe_subscription" },
		});
		expect(await detect()).toEqual([]);
	});

	test("a revoked refresh token is not a sign-in even when the account says subscription", async () => {
		put(credentials(), {
			claudeAiOauth: {
				accessToken: "",
				refreshToken: "",
				expiresAt: 0,
				scopes: ["user:inference"],
			},
		});
		put(join(home, ".claude.json"), {
			oauthAccount: { accountUuid: "u", billingType: "stripe_subscription" },
		});
		expect(await detect()).toEqual([]);
	});

	test("the keychain-only macOS sign-in is seen through subscription billing in .claude.json", async () => {
		put(join(home, ".claude.json"), {
			oauthAccount: { accountUuid: "u", billingType: "apple_subscription" },
		});
		expect(await detect()).toEqual([{ source: "claude-code", providerIds: ["anthropic"] }]);
	});

	test("an account without subscription billing, or with an API key only, is not detected", async () => {
		put(join(home, ".claude.json"), { oauthAccount: { accountUuid: "u" } });
		expect(await detect()).toEqual([]);
		put(join(home, ".claude.json"), {
			oauthAccount: { accountUuid: "u", billingType: "prepaid" },
		});
		expect(await detect()).toEqual([]);
		put(join(home, ".claude.json"), { primaryApiKey: "sk-ant" });
		expect(await detect()).toEqual([]);
	});

	test("after /logout the account is gone, so nothing is detected", async () => {
		put(join(home, ".claude.json"), { hasCompletedOnboarding: false });
		expect(await detect()).toEqual([]);
	});

	test("CLAUDE_CONFIG_DIR moves both files and the home config is ignored", async () => {
		const dir = join(home, "elsewhere");
		put(join(home, ".claude.json"), {
			oauthAccount: { accountUuid: "ignored", billingType: "stripe_subscription" },
		});
		put(join(dir, ".claude.json"), { primaryApiKey: "sk-ant" });
		expect(await detect({ CLAUDE_CONFIG_DIR: dir })).toEqual([]);

		put(join(dir, ".credentials.json"), subscription);
		expect(await sources({ CLAUDE_CONFIG_DIR: dir })).toEqual(["claude-code"]);
	});

	test("a non-empty legacy .config.json wins over .claude.json", async () => {
		put(join(home, ".claude", ".config.json"), { oauthAccount: { accountUuid: "u" } });
		put(join(home, ".claude.json"), {
			oauthAccount: { accountUuid: "u", billingType: "stripe_subscription" },
		});
		expect(await detect()).toEqual([]);

		put(join(home, ".claude", ".config.json"), {});
		expect(await sources()).toEqual(["claude-code"]);
	});

	test("CLAUDE_SECURESTORAGE_CONFIG_DIR relocates only the credentials file", async () => {
		const secure = join(home, "secure");
		put(join(secure, ".credentials.json"), subscription);
		expect(await sources({ CLAUDE_SECURESTORAGE_CONFIG_DIR: secure })).toEqual(["claude-code"]);
	});

	test("a long-lived CLAUDE_CODE_OAUTH_TOKEN is a subscription sign-in", async () => {
		expect(await sources({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat" })).toEqual(["claude-code"]);
		expect(await sources({ CLAUDE_CODE_OAUTH_TOKEN: "  " })).toEqual([]);
	});
});

describe("Codex", () => {
	const authPath = () => join(home, ".codex", "auth.json");
	const tokens = (claims: unknown = {}) => ({
		id_token: idToken(claims),
		access_token: "secret",
		refresh_token: "secret",
	});

	test("a ChatGPT sign-in prefers pi's openai provider and reads the plan from the id token", async () => {
		put(authPath(), {
			auth_mode: "chatgpt",
			OPENAI_API_KEY: null,
			tokens: tokens({ "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }),
		});
		expect(await detect()).toEqual([
			{ source: "codex", providerIds: ["openai", "openai-codex"], plan: "plus" },
		]);
	});

	test("API-key mode is not a sign-in even when stale tokens remain", async () => {
		put(authPath(), { auth_mode: "apikey", OPENAI_API_KEY: "sk-openai", tokens: tokens() });
		expect(await detect()).toEqual([]);
	});

	test("other auth modes are not a ChatGPT sign-in", async () => {
		for (const auth_mode of ["personalAccessToken", "bedrockApiKey", "agentIdentity", "headers"]) {
			put(authPath(), { auth_mode, tokens: tokens() });
			expect(await detect()).toEqual([]);
		}
	});

	test("a legacy file without auth_mode resolves like Codex does", async () => {
		put(authPath(), { OPENAI_API_KEY: null, tokens: tokens() });
		expect(await sources()).toEqual(["codex"]);
		put(authPath(), { OPENAI_API_KEY: "sk-openai", tokens: tokens() });
		expect(await detect()).toEqual([]);
		put(authPath(), { personal_access_token: "pat", tokens: tokens() });
		expect(await detect()).toEqual([]);
	});

	test("a missing refresh token is not a sign-in", async () => {
		put(authPath(), { auth_mode: "chatgpt", tokens: { id_token: idToken({}), refresh_token: "" } });
		expect(await detect()).toEqual([]);
		put(authPath(), { auth_mode: "chatgpt", tokens: null });
		expect(await detect()).toEqual([]);
	});

	test("CODEX_HOME is honoured and an unreadable id token still detects the sign-in", async () => {
		put(join(home, "codex", "auth.json"), {
			auth_mode: "chatgpt",
			tokens: { id_token: "garbage", refresh_token: "secret" },
		});
		expect(await detect({ CODEX_HOME: join(home, "codex") })).toEqual([
			{ source: "codex", providerIds: ["openai", "openai-codex"] },
		]);
	});

	test("keyring storage leaves no auth.json, so nothing is detected", async () => {
		put(join(home, ".codex", "config.toml"), 'cli_auth_credentials_store = "keyring"\n');
		expect(await detect()).toEqual([]);
	});
});

describe("GitHub Copilot", () => {
	test("an editor plugin's apps.json entry is detected; an empty one is not", async () => {
		const apps = join(home, ".config", "github-copilot", "apps.json");
		put(apps, {});
		expect(await detect()).toEqual([]);
		put(apps, { "github.com:Iv1.b507a08c87ecfe98": { user: "octocat", oauth_token: "x" } });
		expect(await detect()).toEqual([{ source: "github-copilot", providerIds: ["github-copilot"] }]);
	});

	test("the legacy hosts.json and an Enterprise host both count", async () => {
		put(join(home, ".config", "github-copilot", "hosts.json"), {
			"ghe.example.com": { user: "octocat", oauth_token: "x" },
		});
		expect(await sources()).toEqual(["github-copilot"]);
	});

	test("an absolute XDG_CONFIG_HOME relocates it; a relative one is ignored", async () => {
		const xdg = join(home, "xdg");
		put(join(xdg, "github-copilot", "apps.json"), { "github.com:Iv1": { user: "octocat" } });
		expect(await sources({ XDG_CONFIG_HOME: xdg })).toEqual(["github-copilot"]);
		expect(await sources({ XDG_CONFIG_HOME: "relative/xdg" })).toEqual([]);
	});

	test("Windows resolves under the profile's AppData/Local", async () => {
		put(join(home, "AppData", "Local", "github-copilot", "apps.json"), {
			"github.com:Iv1": { user: "octocat" },
		});
		expect(await sources({}, "win32")).toEqual(["github-copilot"]);
	});

	test("the Copilot CLI's commented config.json lists signed-in users", async () => {
		const config = join(home, ".copilot", "config.json");
		put(config, '// User settings belong in settings.json.\n{"loggedInUsers": []}');
		expect(await detect()).toEqual([]);
		put(
			config,
			'// User settings belong in settings.json.\n{"loggedInUsers": [{"host": "https://github.com", "login": "octocat"}]}',
		);
		expect(await detect()).toEqual([{ source: "copilot-cli", providerIds: ["github-copilot"] }]);
	});

	test("COPILOT_HOME relocates the Copilot CLI config", async () => {
		put(join(home, "cp", "config.json"), { loggedInUsers: [{ login: "octocat" }] });
		expect(await sources({ COPILOT_HOME: join(home, "cp") })).toEqual(["copilot-cli"]);
	});
});

describe("Kimi CLI", () => {
	test("a subscription token file with a refresh token is detected", async () => {
		const token = join(home, ".kimi", "credentials", "kimi-code.json");
		put(token, { access_token: "secret", refresh_token: "" });
		expect(await detect()).toEqual([]);
		put(token, { access_token: "secret", refresh_token: "secret", expires_at: 0 });
		expect(await detect()).toEqual([{ source: "kimi-cli", providerIds: ["kimi-coding"] }]);
	});

	test("KIMI_SHARE_DIR relocates it", async () => {
		put(join(home, "share", "credentials", "kimi-code.json"), { refresh_token: "secret" });
		expect(await sources({ KIMI_SHARE_DIR: join(home, "share") })).toEqual(["kimi-cli"]);
	});
});

describe("Grok Build", () => {
	const authPath = () => join(home, ".grok", "auth.json");

	test("a subscription scope with a refresh token is detected; the API-key scope is not", async () => {
		put(authPath(), { "xai::api_key": { key: "xai-secret", auth_mode: "api_key" } });
		expect(await detect()).toEqual([]);
		put(authPath(), {
			"https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": {
				key: "secret",
				refresh_token: "secret",
				auth_mode: "web_login",
			},
		});
		expect(await detect()).toEqual([{ source: "grok-build", providerIds: ["xai"] }]);
	});

	test("without a refresh token only an unexpired session counts", async () => {
		const scope = "https://accounts.x.ai/sign-in";
		put(authPath(), { [scope]: { key: "secret", expires_at: "2026-10-01T00:00:00Z" } });
		expect(await detect()).toEqual([]);
		put(authPath(), { [scope]: { key: "secret", expires_at: "2026-11-01T00:00:00Z" } });
		expect(await sources()).toEqual(["grok-build"]);
		put(authPath(), { [scope]: { key: "secret", expires_at: NOW / 1000 + 60 } });
		expect(await sources()).toEqual(["grok-build"]);
	});

	test("GROK_AUTH_PATH wins over GROK_HOME", async () => {
		const entry = { "https://auth.x.ai::c": { refresh_token: "secret" } };
		put(join(home, "g", "auth.json"), entry);
		put(join(home, "explicit.json"), entry);
		expect(await sources({ GROK_HOME: join(home, "g") })).toEqual(["grok-build"]);
		expect(
			await sources({
				GROK_HOME: join(home, "missing"),
				GROK_AUTH_PATH: join(home, "explicit.json"),
			}),
		).toEqual(["grok-build"]);
	});
});

describe("file robustness", () => {
	test("a UTF-8 BOM is tolerated", async () => {
		put(join(home, ".kimi", "credentials", "kimi-code.json"), '﻿{"refresh_token":"secret"}');
		expect(await sources()).toEqual(["kimi-cli"]);
	});

	test("malformed, non-object, directory, and oversized files are ignored", async () => {
		put(join(home, ".claude", ".credentials.json"), "{not json");
		put(join(home, ".codex", "auth.json"), "[]");
		mkdirSync(join(home, ".copilot", "config.json"), { recursive: true });
		put(
			join(home, ".kimi", "credentials", "kimi-code.json"),
			`{"refresh_token":"secret","pad":"${"x".repeat(1024 * 1024)}"}`,
		);
		expect(await detect()).toEqual([]);
	});

	test("the HOME environment variable locates the default home", async () => {
		put(join(home, ".kimi", "credentials", "kimi-code.json"), { refresh_token: "secret" });
		const signals = await detectAccountSignals({
			env: { HOME: home },
			platform: "linux",
			now: NOW,
		});
		expect(signals.map((signal) => signal.source)).toEqual(["kimi-cli"]);
	});

	test("no signal ever carries a credential value", async () => {
		put(join(home, ".claude", ".credentials.json"), {
			claudeAiOauth: {
				accessToken: "sk-secret-access",
				refreshToken: "sk-secret-refresh",
				scopes: ["user:inference"],
			},
		});
		put(join(home, ".codex", "auth.json"), {
			auth_mode: "chatgpt",
			tokens: { id_token: idToken({ email: "sk-secret-mail" }), refresh_token: "sk-secret-codex" },
		});
		expect(JSON.stringify(await detect({ CLAUDE_CODE_OAUTH_TOKEN: "" }))).not.toContain(
			"sk-secret",
		);
	});
});

describe("resolveDetectedAccounts", () => {
	const signals: AccountSignal[] = [
		{ source: "claude-code", providerIds: ["anthropic"], plan: "max" },
		{ source: "codex", providerIds: ["openai", "openai-codex"] },
		{ source: "github-copilot", providerIds: ["github-copilot"] },
		{ source: "copilot-cli", providerIds: ["github-copilot"] },
	];

	test("picks the first OAuth-capable provider and keeps one account per provider", () => {
		const oauth = new Set(["anthropic", "openai", "openai-codex", "github-copilot"]);
		expect(resolveDetectedAccounts(signals, (id) => oauth.has(id))).toEqual([
			{ providerId: "anthropic", source: "claude-code", plan: "max" },
			{ providerId: "openai", source: "codex" },
			{ providerId: "github-copilot", source: "github-copilot" },
		]);
	});

	test("falls back to the legacy Codex provider and drops providers pi cannot sign in to", () => {
		const oauth = new Set(["openai-codex"]);
		expect(resolveDetectedAccounts(signals, (id) => oauth.has(id))).toEqual([
			{ providerId: "openai-codex", source: "codex" },
		]);
	});
});
