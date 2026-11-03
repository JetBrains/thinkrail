import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseAnthropicUsage,
	parseAntigravityQuota,
	parseCodexUsage,
	parseOpenRouterKey,
	readSubscriptionUsage,
	resetInstant,
	resetSubscriptionUsageCache,
	type SubscriptionUsageDeps,
} from "./subscriptions";

const HOME_CLEANUP: string[] = [];
const NEVER = 1_800_000_000_000;

function tempHome(files: Record<string, unknown> = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-usage-"));
	HOME_CLEANUP.push(dir);
	for (const [relative, value] of Object.entries(files)) {
		const path = join(dir, relative);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, JSON.stringify(value));
	}
	return dir;
}

function deps(
	homeDir: string,
	responses: Record<string, unknown> = {},
	tokens: Record<string, string> = {},
): SubscriptionUsageDeps {
	return {
		homeDir,
		now: () => NEVER,
		readPiProviderToken: async (providerId) => tokens[providerId] ?? null,
		fetchImpl: (async (input: string | URL | Request) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const body = responses[url];
			if (body === undefined) return new Response("no", { status: 500 });
			return new Response(JSON.stringify(body), { status: 200 });
		}) as unknown as typeof fetch,
	};
}

afterEach(() => {
	resetSubscriptionUsageCache();
	for (const dir of HOME_CLEANUP.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resetInstant", () => {
	test("reads epoch seconds, milliseconds and ISO strings", () => {
		expect(resetInstant(1_800_000_000)).toBe(1_800_000_000_000);
		expect(resetInstant(1_800_000_000_000)).toBe(1_800_000_000_000);
		expect(resetInstant("2026-11-05T10:00:00.000Z")).toBe(Date.parse("2026-11-05T10:00:00.000Z"));
		expect(resetInstant(null)).toBeNull();
		expect(resetInstant("nonsense")).toBeNull();
	});
});

describe("parseCodexUsage", () => {
	test("keeps the windows a Codex answer carries", () => {
		const usage = parseCodexUsage({
			rate_limit: {
				primary_window: {
					used_percent: 13,
					limit_window_seconds: 604_800,
					reset_at: 1_794_209_817,
				},
				secondary_window: null,
			},
		});
		expect(usage).toEqual({
			state: "ok",
			windows: [{ usedPercent: 13, windowSeconds: 604_800, resetsAt: 1_794_209_817_000 }],
		});
	});

	test("is unavailable without a rate limit block", () => {
		expect(parseCodexUsage({ credits: { balance: "0E-10" } })).toEqual({ state: "unavailable" });
		expect(parseCodexUsage(null)).toEqual({ state: "unavailable" });
	});
});

describe("parseOpenRouterKey", () => {
	test("reports spend and the key limit", () => {
		expect(parseOpenRouterKey({ data: { limit: 50, usage: 12.4 } })).toEqual({
			state: "ok",
			windows: [],
			spend: { usedUsd: 12.4, limitUsd: 50 },
		});
	});

	test("keeps spend when no limit is set", () => {
		expect(parseOpenRouterKey({ data: { limit: null, usage: 0 } })).toEqual({
			state: "ok",
			windows: [],
			spend: { usedUsd: 0, limitUsd: null },
		});
	});
});

describe("parseAntigravityQuota", () => {
	test("turns remaining fractions into one window per model", () => {
		const usage = parseAntigravityQuota({
			buckets: [
				{ modelId: "gemini-3-pro", remainingFraction: 0.18, resetTime: "2026-11-03T12:00:00Z" },
				{ modelId: "gemini-3-flash", remainingFraction: 0.8 },
			],
		});
		expect(usage).toEqual({
			state: "ok",
			windows: [
				{
					usedPercent: 82,
					windowSeconds: null,
					resetsAt: Date.parse("2026-11-03T12:00:00Z"),
					model: "gemini-3-pro",
				},
				{ usedPercent: 20, windowSeconds: null, resetsAt: null, model: "gemini-3-flash" },
			],
		});
	});
});

describe("parseAnthropicUsage", () => {
	test("maps the subscription lanes", () => {
		const usage = parseAnthropicUsage({
			five_hour: { utilization: 15, resets_at: "2026-11-03T18:05:00Z" },
			seven_day: { utilization: 32 },
		});
		expect(usage).toEqual({
			state: "ok",
			windows: [
				{
					usedPercent: 15,
					windowSeconds: 18_000,
					resetsAt: Date.parse("2026-11-03T18:05:00Z"),
				},
				{ usedPercent: 32, windowSeconds: 604_800, resetsAt: null },
			],
		});
	});
});

describe("readSubscriptionUsage", () => {
	test("collects every provider and marks what cannot answer", async () => {
		const home = tempHome({
			".codex/auth.json": { tokens: { access_token: "codex-token", account_id: "acc" } },
		});
		const snapshot = await readSubscriptionUsage({
			force: true,
			deps: deps(
				home,
				{
					"https://chatgpt.com/backend-api/wham/usage": {
						rate_limit: { primary_window: { used_percent: 42, reset_at: 1_794_209_817 } },
					},
					"https://openrouter.ai/api/v1/key": { data: { limit: null, usage: 3 } },
				},
				{ openrouter: "openrouter-token" },
			),
		});
		const byId = Object.fromEntries(snapshot.rows.map((row) => [row.providerId, row.usage]));
		expect(byId.codex).toEqual({
			state: "ok",
			windows: [{ usedPercent: 42, windowSeconds: null, resetsAt: 1_794_209_817_000 }],
		});
		expect(byId.openrouter).toEqual({
			state: "ok",
			windows: [],
			spend: { usedUsd: 3, limitUsd: null },
		});
		expect(byId.antigravity).toEqual({ state: "sign-in" });
		expect(byId.claude).toEqual({ state: "unavailable" });
		expect(byId["opencode-go"]).toEqual({ state: "unsupported" });
		expect(snapshot.observedAt).toBe(NEVER);
	});

	test("asks for a sign-in while the Google token is expired", async () => {
		const home = tempHome({
			".gemini/oauth_creds.json": { access_token: "google-token", expiry_date: 1_000 },
		});
		const snapshot = await readSubscriptionUsage({ force: true, deps: deps(home) });
		const antigravity = snapshot.rows.find((row) => row.providerId === "antigravity");
		expect(antigravity?.usage).toEqual({ state: "sign-in" });
	});

	test("keeps a live Google quota when the token is still valid", async () => {
		const home = tempHome({
			".gemini/oauth_creds.json": { access_token: "google-token", expiry_date: NEVER + 1 },
		});
		const snapshot = await readSubscriptionUsage({
			force: true,
			deps: deps(home, {
				"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota": {
					buckets: [{ modelId: "gemini-3-pro", remainingFraction: 0.5 }],
				},
			}),
		});
		const antigravity = snapshot.rows.find((row) => row.providerId === "antigravity");
		expect(antigravity?.usage).toEqual({
			state: "ok",
			windows: [{ usedPercent: 50, windowSeconds: null, resetsAt: null, model: "gemini-3-pro" }],
		});
	});

	test("serves the cached snapshot until forced", async () => {
		const home = tempHome();
		const options = { deps: deps(home) };
		const first = await readSubscriptionUsage({ ...options, force: true });
		const second = await readSubscriptionUsage(options);
		expect(second).toBe(first);
	});

	test("never puts a credential into the snapshot", async () => {
		const home = tempHome({
			".codex/auth.json": { tokens: { access_token: "secret-codex-token" } },
		});
		const snapshot = await readSubscriptionUsage({
			force: true,
			deps: deps(
				home,
				{
					"https://chatgpt.com/backend-api/wham/usage": {
						rate_limit: { primary_window: { used_percent: 1 } },
					},
					"https://openrouter.ai/api/v1/key": { data: { usage: 0 } },
				},
				{ openrouter: "secret-openrouter-token" },
			),
		});
		expect(JSON.stringify(snapshot)).not.toContain("secret-");
	});
});
