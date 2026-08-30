import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { ensureInstallation } from "../persistence";
import { type AnalyticsEvent, bucketProvider, bucketProviderModel, CUSTOM_BUCKET } from "./events";
import {
	initializeAnalytics,
	resetAnalyticsForTests,
	setAnalyticsSending,
	shutdownAnalytics,
	track,
} from "./service";
import { POSTHOG_PROJECT_KEY } from "./sink";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-analytics-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetAnalyticsForTests();
});

afterEach(() => {
	resetAnalyticsForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

interface BatchEntry {
	event: string;
	distinct_id: string;
	properties: Record<string, unknown>;
}

interface SentPayload {
	url: string;
	body: { api_key: string; batch: BatchEntry[] };
}

function makeFetch(sent: SentPayload[]): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return Promise.resolve(new Response("{}", { status: 200 }));
	}) as typeof fetch;
}

function allEntries(sent: SentPayload[]): BatchEntry[] {
	return sent.flatMap((p) => p.body.batch);
}

async function drained(sent: SentPayload[], count: number): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (allEntries(sent).length < count && Date.now() < deadline) await Bun.sleep(5);
	expect(allEntries(sent).length).toBeGreaterThanOrEqual(count);
}

const settled = (): Promise<void> => Bun.sleep(25);

function bootSending(
	sent: SentPayload[],
	overrides: Partial<Parameters<typeof initializeAnalytics>[0]> = {},
): void {
	initializeAnalytics({
		appVersion: "1.2.3",
		channel: "stable",
		build: "binary",
		enabled: true,
		env: {},
		fetchImpl: makeFetch(sent),
		...overrides,
	});
}

const EVENT_SAMPLES = {
	app_installed: { name: "app_installed" },
	app_started: { name: "app_started" },
	chat_started: { name: "chat_started", params: { provider: "anthropic", model: "some-model" } },
	message_sent: { name: "message_sent", params: { mode: "prompt" } },
	provider_login: { name: "provider_login", params: { provider: "openai", method: "oauth" } },
} as const satisfies { [K in AnalyticsEvent["name"]]: Extract<AnalyticsEvent, { name: K }> };

const ENV_KEYS = ["app_version", "channel", "os", "arch", "build"];

const EXPECTED_KEYS: Record<keyof typeof EVENT_SAMPLES, string[]> = {
	app_installed: ENV_KEYS,
	app_started: ENV_KEYS,
	chat_started: [...ENV_KEYS, "provider", "model"],
	message_sent: [...ENV_KEYS, "mode"],
	provider_login: [...ENV_KEYS, "provider", "method"],
};

test("every event's outgoing properties are EXACTLY its declared params (+ $ transport framing)", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent);
	for (const event of Object.values(EVENT_SAMPLES)) track(event);
	await drained(sent, 2 + Object.keys(EVENT_SAMPLES).length);
	for (const entry of allEntries(sent)) {
		const plainKeys = Object.keys(entry.properties)
			.filter((key) => !key.startsWith("$"))
			.sort();
		const expected = EXPECTED_KEYS[entry.event as keyof typeof EXPECTED_KEYS];
		expect(expected).toBeDefined();
		expect(plainKeys).toEqual([...expected].sort());
		expect(entry.properties.$process_person_profile).toBe(false);
		expect(entry.properties.$geoip_disable).toBe(true);
	}
});

test("every event is stamped with the env metadata", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent);
	track({ name: "app_started" });
	await drained(sent, 3);
	const entry = allEntries(sent).at(-1);
	expect(entry?.properties).toMatchObject({
		app_version: "1.2.3",
		channel: "stable",
		build: "binary",
	});
	expect(entry?.properties.os).toBeString();
	expect(entry?.properties.arch).toBeString();
});

test("desktop provenance is reported without collapsing it into binary", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent, { build: "desktop" });
	await drained(sent, 2);
	expect(allEntries(sent).every((entry) => entry.properties.build === "desktop")).toBe(true);
});

test("the batch goes to the EU cloud by default; THINKRAIL_POSTHOG_HOST retargets it", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent);
	await drained(sent, 1);
	expect(sent[0]?.url).toBe("https://eu.i.posthog.com/batch/");

	resetAnalyticsForTests();
	const retargeted: SentPayload[] = [];
	bootSending(retargeted, { env: { THINKRAIL_POSTHOG_HOST: "https://ph.example.test/" } });
	await drained(retargeted, 1);
	expect(retargeted[0]?.url).toBe("https://ph.example.test/batch/");
});

test("shutdownAnalytics genuinely awaits the drain (slow transport, no polling) and never throws", async () => {
	const sent: SentPayload[] = [];
	const slowFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
		await Bun.sleep(50);
		sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return new Response("{}", { status: 200 });
	}) as typeof fetch;
	bootSending(sent, { fetchImpl: slowFetch });
	track({ name: "chat_started", params: { provider: "anthropic", model: "m" } });
	await shutdownAnalytics();
	expect(allEntries(sent).map((e) => e.event)).toEqual([
		"app_installed",
		"app_started",
		"chat_started",
	]);
	await shutdownAnalytics();
});

test("toggle-off silences events already queued inside the SDK — the transport gate", async () => {
	const delivered: SentPayload[] = [];
	let started = 0;
	const slowFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
		started++;
		await Bun.sleep(100);
		delivered.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return new Response("{}", { status: 200 });
	}) as typeof fetch;
	bootSending(delivered, { fetchImpl: slowFetch });
	await drained(delivered, 2);

	const startedBefore = started;
	track({ name: "chat_started", params: { provider: "anthropic", model: "m" } });
	const deadline = Date.now() + 2_000;
	while (started === startedBefore && Date.now() < deadline) await Bun.sleep(5);
	expect(started).toBeGreaterThan(startedBefore);

	track({ name: "provider_login", params: { provider: "openai", method: "oauth" } });
	setAnalyticsSending(false);
	await shutdownAnalytics();
	await Bun.sleep(150);

	const events = allEntries(delivered).map((e) => e.event);
	expect(events).toContain("chat_started");
	expect(events).not.toContain("provider_login");
});

test("the install id is minted once, used as distinct_id, and NEVER rotated by toggles", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent);
	await drained(sent, 1);
	const id = ensureInstallation().id;
	expect(allEntries(sent)[0]?.distinct_id).toBe(id);

	setAnalyticsSending(false);
	setAnalyticsSending(true);
	track({ name: "app_started" });
	await drained(sent, 3);
	expect(allEntries(sent).at(-1)?.distinct_id).toBe(id);
	expect(ensureInstallation().id).toBe(id);
});

test("app_installed fires exactly once per install (announced bit survives restarts)", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent);
	await drained(sent, 2);
	expect(allEntries(sent).map((e) => e.event)).toEqual(["app_installed", "app_started"]);

	resetAnalyticsForTests();
	const sentAfterRestart: SentPayload[] = [];
	bootSending(sentAfterRestart);
	await drained(sentAfterRestart, 1);
	await settled();
	expect(allEntries(sentAfterRestart).map((e) => e.event)).toEqual(["app_started"]);
});

test("a disabled boot mints the id but sends nothing; enabling later announces once", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent, { enabled: false });
	await settled();
	expect(sent).toHaveLength(0);
	expect(readFileSync(join(dataDir, "installation.json"), "utf8")).toContain('"announced": false');

	setAnalyticsSending(true);
	await drained(sent, 1);
	expect(allEntries(sent).map((e) => e.event)).toEqual(["app_installed"]);
	setAnalyticsSending(true);
	await settled();
	expect(allEntries(sent)).toHaveLength(1);
});

test("a run from source on the dev channel sends — the release allowlist is gone", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent, { appVersion: "0.0.0-dev", channel: "dev", build: "source" });
	await drained(sent, 2);
	expect(allEntries(sent).at(-1)?.properties).toMatchObject({
		app_version: "0.0.0-dev",
		channel: "dev",
		build: "source",
	});
});

test("channel is reported verbatim and gates nothing — an unrecognized one still sends", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent, { channel: "beta" });
	await drained(sent, 2);
	expect(allEntries(sent).at(-1)?.properties).toMatchObject({ channel: "beta" });
});

test("events go to the committed project key when the launcher passes none", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent);
	await drained(sent, 1);
	expect(sent[0]?.body.api_key).toBe(POSTHOG_PROJECT_KEY);
});

test.each([
	["THINKRAIL_NO_ANALYTICS", { THINKRAIL_NO_ANALYTICS: "1" }],
	["CI", { CI: "true" }],
	["NODE_ENV=test", { NODE_ENV: "test" }],
])("an environment mute (%s) sends nothing at all", async (_label, env) => {
	const sent: SentPayload[] = [];
	bootSending(sent, { env });
	track({ name: "message_sent", params: { mode: "prompt" } });
	await settled();
	expect(allEntries(sent)).toEqual([]);
});

test("--no-analytics (mute) silences the run even when the config says send", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent, { mute: true });
	track({ name: "app_started" });
	setAnalyticsSending(true);
	track({ name: "app_started" });
	await settled();
	expect(sent).toHaveLength(0);
});

test("setAnalyticsSending(false) stops sending immediately", async () => {
	const sent: SentPayload[] = [];
	bootSending(sent);
	await drained(sent, 2);
	sent.length = 0;
	setAnalyticsSending(false);
	track({ name: "chat_started", params: { provider: "anthropic", model: "m" } });
	await settled();
	expect(sent).toHaveLength(0);
});

test("track never throws into the caller, even when the transport does", async () => {
	initializeAnalytics({
		channel: "stable",
		enabled: true,
		env: {},
		fetchImpl: (() => {
			throw new Error("boom");
		}) as unknown as typeof fetch,
	});
	expect(() => track({ name: "app_started" })).not.toThrow();
	await settled();
});

test("a pi built-in provider + model pass through raw", () => {
	const model = getBuiltinModels("anthropic")[0];
	if (!model) throw new Error("pi catalog has no anthropic models — update the test");
	expect(bucketProviderModel("anthropic", model.id)).toEqual({
		provider: "anthropic",
		model: model.id,
	});
	expect(bucketProvider("anthropic")).toBe("anthropic");
});

test("a custom provider — and its model — bucket to custom (fails closed)", () => {
	expect(bucketProviderModel("acme-internal", "secret-model-v2")).toEqual({
		provider: CUSTOM_BUCKET,
		model: CUSTOM_BUCKET,
	});
	expect(bucketProvider("acme-internal")).toBe(CUSTOM_BUCKET);
});

test("a custom model id on a known provider buckets the model but keeps the provider", () => {
	expect(bucketProviderModel("openai", "my-private-finetune")).toEqual({
		provider: "openai",
		model: CUSTOM_BUCKET,
	});
});
