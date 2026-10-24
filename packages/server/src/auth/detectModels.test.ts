import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detectModels } from "./detectModels";

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
	detectModels({ env, homeDir: home, platform });

test("an empty home detects nothing", async () => {
	expect(await detect()).toEqual([]);
});

test("Claude Code: a credentials file yields its subscription plan", async () => {
	put(join(home, ".claude", ".credentials.json"), {
		claudeAiOauth: { accessToken: "secret", subscriptionType: "max" },
	});
	expect(await detect()).toEqual([{ providerId: "anthropic", source: "claude-code", plan: "max" }]);
});

test("Claude Code: the keychain-only macOS sign-in is seen through the account in .claude.json", async () => {
	put(join(home, ".claude.json"), { oauthAccount: { accountUuid: "u" } });
	expect(await detect()).toEqual([{ providerId: "anthropic", source: "claude-code" }]);
});

test("Claude Code: CLAUDE_CONFIG_DIR moves both files, and an API-key-only config is not a sign-in", async () => {
	const dir = join(home, "elsewhere");
	put(join(home, ".claude.json"), { oauthAccount: { accountUuid: "ignored" } });
	put(join(dir, ".claude.json"), { primaryApiKey: "sk-ant" });
	expect(await detect({ CLAUDE_CONFIG_DIR: dir })).toEqual([]);

	put(join(dir, ".claude.json"), { oauthAccount: { accountUuid: "u" } });
	expect(await detect({ CLAUDE_CONFIG_DIR: dir })).toEqual([
		{ providerId: "anthropic", source: "claude-code" },
	]);
});

test("Codex: a ChatGPT sign-in yields the plan from its id token; an API key alone does not", async () => {
	const authPath = join(home, ".codex", "auth.json");
	put(authPath, { OPENAI_API_KEY: "sk-openai", tokens: null });
	expect(await detect()).toEqual([]);

	put(authPath, {
		tokens: {
			id_token: idToken({ "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }),
			refresh_token: "secret",
		},
	});
	expect(await detect()).toEqual([{ providerId: "openai-codex", source: "codex", plan: "plus" }]);
});

test("Codex: CODEX_HOME is honoured and an unreadable id token still detects the sign-in", async () => {
	put(join(home, "codex", "auth.json"), { auth_mode: "chatgpt", tokens: { id_token: "garbage" } });
	expect(await detect({ CODEX_HOME: join(home, "codex") })).toEqual([
		{ providerId: "openai-codex", source: "codex" },
	]);
});

test("Copilot: a token file under the platform's config dir is detected; an empty one is not", async () => {
	put(join(home, ".config", "github-copilot", "apps.json"), {});
	expect(await detect()).toEqual([]);

	put(join(home, ".config", "github-copilot", "hosts.json"), {
		"github.com": { oauth_token: "x" },
	});
	expect(await detect()).toEqual([{ providerId: "github-copilot", source: "github-copilot" }]);

	const local = join(home, "Local");
	put(join(local, "github-copilot", "apps.json"), { "github.com:Iv1": { oauth_token: "x" } });
	expect(await detect({ LOCALAPPDATA: local }, "win32")).toEqual([
		{ providerId: "github-copilot", source: "github-copilot" },
	]);
});

test("malformed files are ignored and detection never returns a credential value", async () => {
	put(join(home, ".claude", ".credentials.json"), "{not json");
	put(join(home, ".codex", "auth.json"), "[]");
	expect(await detect()).toEqual([]);

	put(join(home, ".claude", ".credentials.json"), {
		claudeAiOauth: { accessToken: "sk-secret-access", refreshToken: "sk-secret-refresh" },
	});
	expect(JSON.stringify(await detect())).not.toContain("sk-secret");
});
