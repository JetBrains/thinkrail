import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { ensureInstallation } from "../persistence";
import {
	type AnalyticsEvent,
	bucketProvider,
	bucketProviderModel,
	CUSTOM_BUCKET,
	PARAM_ALLOWLIST,
} from "./events";
import { initializeAnalytics, resetAnalyticsForTests, setAnalyticsSending, track } from "./service";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const savedEnv = {
	key: process.env.THINKRAIL_POSTHOG_API_KEY,
	host: process.env.THINKRAIL_POSTHOG_HOST,
};

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-analytics-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	delete process.env.THINKRAIL_POSTHOG_API_KEY;
	delete process.env.THINKRAIL_POSTHOG_HOST;
	resetAnalyticsForTests();
});

afterEach(() => {
	resetAnalyticsForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	if (savedEnv.key === undefined) delete process.env.THINKRAIL_POSTHOG_API_KEY;
	else process.env.THINKRAIL_POSTHOG_API_KEY = savedEnv.key;
	if (savedEnv.host === undefined) delete process.env.THINKRAIL_POSTHOG_HOST;
	else process.env.THINKRAIL_POSTHOG_HOST = savedEnv.host;
});

// ── test fetch (the sink's injected seam) ──────────────────────────────

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
		return Promise.resolve(new Response("ok"));
	}) as typeof fetch;
}

/** Boot the service on the baked-key path (release-like: key + a non-dev channel). */
function bootReleaseLike(
	sent: SentPayload[],
	overrides: Partial<Parameters<typeof initializeAnalytics>[0]> = {},
): void {
	initializeAnalytics({
		appVersion: "1.2.3",
		channel: "stable",
		posthogApiKey: "phc_TEST",
		enabled: true,
		fetchImpl: makeFetch(sent),
		...overrides,
	});
}

/** Every batch entry across every captured payload. */
function allEntries(sent: SentPayload[]): BatchEntry[] {
	return sent.flatMap((p) => p.body.batch);
}

// ── the machine-checked privacy invariant ──────────────────────────────

// One fully-populated sample per event variant. The `satisfies` map is EXHAUSTIVE over the union's
// names — adding a new event variant without a sample here is a compile error, so the allowlist
// assertions below always cover the whole event model (thinkrail-v1's allowlist test, in TS).
const EVENT_SAMPLES = {
	app_installed: { name: "app_installed" },
	app_started: { name: "app_started" },
	chat_started: { name: "chat_started", params: { provider: "anthropic", model: "some-model" } },
	provider_login: { name: "provider_login", params: { provider: "openai", method: "oauth" } },
} as const satisfies { [K in AnalyticsEvent["name"]]: Extract<AnalyticsEvent, { name: K }> };

test("every event's outgoing properties are allowlist params + the two $ transport flags only", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	for (const event of Object.values(EVENT_SAMPLES)) track(event);
	expect(sent.length).toBeGreaterThanOrEqual(Object.keys(EVENT_SAMPLES).length);
	for (const entry of allEntries(sent)) {
		for (const key of Object.keys(entry.properties)) {
			if (key.startsWith("$")) continue; // transport framing, asserted below
			expect(PARAM_ALLOWLIST.has(key)).toBe(true);
		}
		// PostHog framing: personless (no person profiles) + GeoIP disabled — on EVERY event.
		expect(entry.properties.$process_person_profile).toBe(false);
		expect(entry.properties.$geoip_disable).toBe(true);
	}
});

test("an off-allowlist param is dropped at runtime (fails closed even past the type system)", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	sent.length = 0; // drop the boot lifecycle events
	// Deliberately malformed via cast: the runtime filter must catch what the compiler can't.
	track({
		name: "chat_started",
		params: { provider: "anthropic", model: "m", leak: "/Users/me/secret-project" },
	} as unknown as AnalyticsEvent);
	const entry = allEntries(sent)[0];
	expect(entry).toBeDefined();
	expect(entry?.properties.leak).toBeUndefined();
	expect(entry?.properties.provider).toBe("anthropic");
});

test("every event is stamped with the env metadata", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	track({ name: "app_started" });
	const entry = allEntries(sent).at(-1);
	expect(entry?.properties).toMatchObject({ app_version: "1.2.3", channel: "stable" });
	expect(entry?.properties.os).toBeString();
	expect(entry?.properties.arch).toBeString();
});

test("the batch goes to the EU cloud by default; THINKRAIL_POSTHOG_HOST retargets it", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	expect(sent[0]?.url).toBe("https://eu.i.posthog.com/batch/");

	resetAnalyticsForTests();
	process.env.THINKRAIL_POSTHOG_HOST = "https://ph.example.test/";
	const retargeted: SentPayload[] = [];
	bootReleaseLike(retargeted);
	expect(retargeted[0]?.url).toBe("https://ph.example.test/batch/");
});

// ── installation identity ──────────────────────────────────────────────

test("the install id is minted once, used as distinct_id, and NEVER rotated by toggles", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	const id = ensureInstallation().id;
	expect(allEntries(sent)[0]?.distinct_id).toBe(id);

	setAnalyticsSending(false);
	setAnalyticsSending(true);
	track({ name: "app_started" });
	expect(allEntries(sent).at(-1)?.distinct_id).toBe(id);
	expect(ensureInstallation().id).toBe(id); // unchanged on disk too
});

test("app_installed fires exactly once per install (announced bit survives restarts)", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	expect(allEntries(sent).map((e) => e.event)).toEqual(["app_installed", "app_started"]);

	// Simulated restart: same data dir, fresh in-memory state.
	resetAnalyticsForTests();
	const sentAfterRestart: SentPayload[] = [];
	bootReleaseLike(sentAfterRestart);
	expect(allEntries(sentAfterRestart).map((e) => e.event)).toEqual(["app_started"]);
});

test("a disabled boot mints the id but sends nothing; enabling later announces once", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent, { enabled: false });
	expect(sent).toHaveLength(0);
	expect(readFileSync(join(dataDir, "installation.json"), "utf8")).toContain('"announced": false');

	setAnalyticsSending(true);
	expect(allEntries(sent).map((e) => e.event)).toEqual(["app_installed"]);
	setAnalyticsSending(true); // idempotent — no second announce
	expect(allEntries(sent)).toHaveLength(1);
});

// ── gates ──────────────────────────────────────────────────────────────

test("the dev channel refuses a baked key — a dev run never sends", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent, { channel: "dev" });
	track({ name: "app_started" });
	expect(sent).toHaveLength(0);
});

test("an explicit THINKRAIL_POSTHOG_API_KEY env key sends even on the dev channel (pipeline testing)", () => {
	process.env.THINKRAIL_POSTHOG_API_KEY = "phc_ENV";
	const sent: SentPayload[] = [];
	initializeAnalytics({ channel: "dev", enabled: true, fetchImpl: makeFetch(sent) });
	expect(sent.length).toBeGreaterThan(0);
	expect(sent[0]?.body.api_key).toBe("phc_ENV");
	expect(allEntries(sent)[0]?.properties.channel).toBe("dev"); // still excludable in insights
});

test("--no-analytics (mute) silences the run even when key + config say send", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent, { mute: true });
	track({ name: "app_started" });
	setAnalyticsSending(true); // a settings toggle during a muted run must not unmute it
	track({ name: "app_started" });
	expect(sent).toHaveLength(0);
});

test("setAnalyticsSending(false) stops sending immediately", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	sent.length = 0;
	setAnalyticsSending(false);
	track({ name: "chat_started", params: { provider: "anthropic", model: "m" } });
	expect(sent).toHaveLength(0);
});

test("track never throws into the caller, even when the transport does", () => {
	initializeAnalytics({
		channel: "stable",
		posthogApiKey: "phc_TEST",
		enabled: true,
		fetchImpl: (() => {
			throw new Error("boom");
		}) as unknown as typeof fetch,
	});
	expect(() => track({ name: "app_started" })).not.toThrow();
});

// ── identity bucketing (closed vocabulary from pi's built-in catalog) ──

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
