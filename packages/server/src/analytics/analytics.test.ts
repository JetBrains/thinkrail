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
const savedEnvKeys = {
	id: process.env.THINKRAIL_GA4_MEASUREMENT_ID,
	secret: process.env.THINKRAIL_GA4_API_SECRET,
};

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-analytics-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	delete process.env.THINKRAIL_GA4_MEASUREMENT_ID;
	delete process.env.THINKRAIL_GA4_API_SECRET;
	resetAnalyticsForTests();
});

afterEach(() => {
	resetAnalyticsForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	if (savedEnvKeys.id === undefined) delete process.env.THINKRAIL_GA4_MEASUREMENT_ID;
	else process.env.THINKRAIL_GA4_MEASUREMENT_ID = savedEnvKeys.id;
	if (savedEnvKeys.secret === undefined) delete process.env.THINKRAIL_GA4_API_SECRET;
	else process.env.THINKRAIL_GA4_API_SECRET = savedEnvKeys.secret;
});

// ── test fetch (the sink's injected seam) ──────────────────────────────

interface SentPayload {
	url: string;
	body: { client_id: string; events: { name: string; params: Record<string, unknown> }[] };
}

function makeFetch(sent: SentPayload[]): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return Promise.resolve(new Response("ok"));
	}) as typeof fetch;
}

/** Boot the service on the baked-keys path (release-like: keys + a non-dev channel). */
function bootReleaseLike(
	sent: SentPayload[],
	overrides: Partial<Parameters<typeof initializeAnalytics>[0]> = {},
): void {
	initializeAnalytics({
		appVersion: "1.2.3",
		channel: "stable",
		measurementId: "G-TEST",
		apiSecret: "s3cret",
		enabled: true,
		fetchImpl: makeFetch(sent),
		...overrides,
	});
}

// ── the machine-checked privacy invariant ──────────────────────────────

// One fully-populated sample per event variant. The `satisfies` map is EXHAUSTIVE over the union's
// names — adding a new event variant without a sample here is a compile error, so the allowlist
// assertions below always cover the whole event model (the v1 allowlist test, in TS).
const EVENT_SAMPLES = {
	app_installed: { name: "app_installed" },
	app_started: { name: "app_started" },
	chat_started: { name: "chat_started", params: { provider: "anthropic", model: "some-model" } },
	provider_login: { name: "provider_login", params: { provider: "openai", method: "oauth" } },
} as const satisfies { [K in AnalyticsEvent["name"]]: Extract<AnalyticsEvent, { name: K }> };

test("every event's outgoing params are a subset of PARAM_ALLOWLIST (privacy invariant)", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	for (const event of Object.values(EVENT_SAMPLES)) track(event);
	expect(sent.length).toBeGreaterThanOrEqual(Object.keys(EVENT_SAMPLES).length);
	for (const payload of sent) {
		for (const event of payload.body.events) {
			for (const key of Object.keys(event.params)) {
				expect(PARAM_ALLOWLIST.has(key)).toBe(true);
			}
		}
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
	expect(sent).toHaveLength(1);
	const params = sent[0]?.body.events[0]?.params ?? {};
	expect(params.leak).toBeUndefined();
	expect(params.provider).toBe("anthropic");
});

test("every event is stamped with env metadata + the GA4 user-counting plumbing", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	track({ name: "app_started" });
	const last = sent.at(-1);
	expect(last?.body.events[0]?.params).toMatchObject({
		app_version: "1.2.3",
		channel: "stable",
		engagement_time_msec: 1,
	});
	expect(last?.body.events[0]?.params.os).toBeString();
	expect(last?.body.events[0]?.params.arch).toBeString();
	expect(last?.body.events[0]?.params.session_id).toBeString();
});

// ── installation identity ──────────────────────────────────────────────

test("the install id is minted once, used as client_id, and NEVER rotated by toggles", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	const id = ensureInstallation().id;
	expect(sent[0]?.body.client_id).toBe(id);

	setAnalyticsSending(false);
	setAnalyticsSending(true);
	track({ name: "app_started" });
	expect(sent.at(-1)?.body.client_id).toBe(id);
	expect(ensureInstallation().id).toBe(id); // unchanged on disk too
});

test("app_installed fires exactly once per install (announced bit survives restarts)", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	expect(sent.map((p) => p.body.events[0]?.name)).toEqual(["app_installed", "app_started"]);

	// Simulated restart: same data dir, fresh in-memory state.
	resetAnalyticsForTests();
	const sentAfterRestart: SentPayload[] = [];
	bootReleaseLike(sentAfterRestart);
	expect(sentAfterRestart.map((p) => p.body.events[0]?.name)).toEqual(["app_started"]);
});

test("a disabled boot mints the id but sends nothing; enabling later announces once", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent, { enabled: false });
	expect(sent).toHaveLength(0);
	expect(readFileSync(join(dataDir, "installation.json"), "utf8")).toContain('"announced": false');

	setAnalyticsSending(true);
	expect(sent.map((p) => p.body.events[0]?.name)).toEqual(["app_installed"]);
	setAnalyticsSending(true); // idempotent — no second announce
	expect(sent).toHaveLength(1);
});

// ── gates ──────────────────────────────────────────────────────────────

test("the dev channel refuses baked keys — a dev run never sends", () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent, { channel: "dev" });
	track({ name: "app_started" });
	expect(sent).toHaveLength(0);
});

test("explicit THINKRAIL_GA4_* env keys send even on the dev channel (pipeline testing)", () => {
	process.env.THINKRAIL_GA4_MEASUREMENT_ID = "G-ENV";
	process.env.THINKRAIL_GA4_API_SECRET = "env-secret";
	const sent: SentPayload[] = [];
	initializeAnalytics({ channel: "dev", enabled: true, fetchImpl: makeFetch(sent) });
	expect(sent.length).toBeGreaterThan(0);
	expect(sent[0]?.url).toContain("measurement_id=G-ENV");
	expect(sent[0]?.body.events[0]?.params.channel).toBe("dev"); // still excludable in reports
});

test("--no-analytics (mute) silences the run even when keys + config say send", () => {
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
		measurementId: "G-TEST",
		apiSecret: "s",
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
