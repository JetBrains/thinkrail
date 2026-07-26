import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeAnalytics, resetAnalyticsForTests } from "../analytics";
import { dropLogin, recordLoginStart, trackLoginOutcome } from "./loginAnalytics";

// The loginId→method correlation between `provider.loginStart` and the login channel's terminal
// frame — the piece that gives `provider_login` an honest `oauth` / `api-key` method.

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

interface BatchEntry {
	event: string;
	properties: Record<string, unknown>;
}

let sent: BatchEntry[];

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-login-analytics-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetAnalyticsForTests();
	sent = [];
	initializeAnalytics({
		channel: "stable",
		posthogApiKey: "phc_TEST",
		enabled: true,
		fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
			sent.push(...JSON.parse(String(init?.body)).batch);
			return Promise.resolve(new Response("{}", { status: 200 }));
		}) as typeof fetch,
	});
});

afterEach(() => {
	resetAnalyticsForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

/** Await until `sent` holds at least `count` events (posthog-node delivers async). */
async function drained(count: number): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (sent.length < count && Date.now() < deadline) await Bun.sleep(5);
	expect(sent.length).toBeGreaterThanOrEqual(count);
}

function logins(): BatchEntry[] {
	return sent.filter((e) => e.event === "provider_login");
}

test("an oauth success tracks provider_login {method: oauth}", async () => {
	recordLoginStart("l1", "oauth");
	trackLoginOutcome({ loginId: "l1", providerId: "anthropic", frame: { kind: "success" } });
	await drained(3); // app_installed + app_started + provider_login
	expect(logins()[0]?.properties).toMatchObject({ provider: "anthropic", method: "oauth" });
});

test("an api_key success tracks provider_login {method: api-key}; the provider is bucketed", async () => {
	recordLoginStart("l1", "api_key");
	trackLoginOutcome({ loginId: "l1", providerId: "acme-internal", frame: { kind: "success" } });
	await drained(3);
	expect(logins()[0]?.properties).toMatchObject({ provider: "custom", method: "api-key" });
});

test("a success for an unknown loginId tracks nothing (fails closed, never a guessed method)", async () => {
	trackLoginOutcome({ loginId: "ghost", providerId: "anthropic", frame: { kind: "success" } });
	await drained(2); // just the boot lifecycle
	await Bun.sleep(25);
	expect(logins()).toHaveLength(0);
});

test("an error frame clears the entry — a later success for the same id tracks nothing", async () => {
	recordLoginStart("l1", "oauth");
	trackLoginOutcome({
		loginId: "l1",
		providerId: "anthropic",
		frame: { kind: "error", message: "nope" },
	});
	trackLoginOutcome({ loginId: "l1", providerId: "anthropic", frame: { kind: "success" } });
	await drained(2);
	await Bun.sleep(25);
	expect(logins()).toHaveLength(0);
});

test("a cancelled login (dropLogin) tracks nothing on a late success", async () => {
	recordLoginStart("l1", "api_key");
	dropLogin("l1");
	trackLoginOutcome({ loginId: "l1", providerId: "openai", frame: { kind: "success" } });
	await drained(2);
	await Bun.sleep(25);
	expect(logins()).toHaveLength(0);
});

test("non-terminal frames leave the entry in place for the real terminal", async () => {
	recordLoginStart("l1", "oauth");
	trackLoginOutcome({
		loginId: "l1",
		providerId: "anthropic",
		frame: { kind: "progress", message: "…" },
	});
	trackLoginOutcome({ loginId: "l1", providerId: "anthropic", frame: { kind: "success" } });
	await drained(3);
	expect(logins()[0]?.properties).toMatchObject({ provider: "anthropic", method: "oauth" });
});
