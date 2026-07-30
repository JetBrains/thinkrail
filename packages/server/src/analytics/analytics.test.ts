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

// posthog-node delivers asynchronously (queue → flush), so the fake fetch fills `sent` a beat after
// `track()` returns. `drained(n)` awaits at least n entries; negative assertions settle briefly first.
function makeFetch(sent: SentPayload[]): typeof fetch {
	return ((url: string | URL | Request, init?: RequestInit) => {
		sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return Promise.resolve(new Response("{}", { status: 200 }));
	}) as typeof fetch;
}

/** Every batch entry across every captured payload. */
function allEntries(sent: SentPayload[]): BatchEntry[] {
	return sent.flatMap((p) => p.body.batch);
}

/** Await until at least `count` events have been delivered to the fake fetch (bounded). */
async function drained(sent: SentPayload[], count: number): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (allEntries(sent).length < count && Date.now() < deadline) await Bun.sleep(5);
	expect(allEntries(sent).length).toBeGreaterThanOrEqual(count);
}

/** A short settle so "nothing was sent" assertions are honest against the async queue. */
const settled = (): Promise<void> => Bun.sleep(25);

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

// ── the machine-checked privacy invariant ──────────────────────────────

// One fully-populated sample per event variant. The `satisfies` map is EXHAUSTIVE over the union's
// names — adding a new event variant without a sample here is a compile error, so the payload pinning
// below always covers the whole event model (the closed union + these exact-set assertions ARE the
// leak guard; there is deliberately no runtime filter).
const EVENT_SAMPLES = {
	app_installed: { name: "app_installed" },
	app_started: { name: "app_started" },
	chat_started: { name: "chat_started", params: { provider: "anthropic", model: "some-model" } },
	message_sent: { name: "message_sent", params: { mode: "prompt" } },
	provider_login: { name: "provider_login", params: { provider: "openai", method: "oauth" } },
} as const satisfies { [K in AnalyticsEvent["name"]]: Extract<AnalyticsEvent, { name: K }> };

const ENV_KEYS = ["app_version", "channel", "os", "arch"];

/** The exact non-`$` property keys each variant may put on the wire — extend only with a spec change. */
const EXPECTED_KEYS: Record<keyof typeof EVENT_SAMPLES, string[]> = {
	app_installed: ENV_KEYS,
	app_started: ENV_KEYS,
	chat_started: [...ENV_KEYS, "provider", "model"],
	message_sent: [...ENV_KEYS, "mode"],
	provider_login: [...ENV_KEYS, "provider", "method"],
};

test("every event's outgoing properties are EXACTLY its declared params (+ $ transport framing)", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	for (const event of Object.values(EVENT_SAMPLES)) track(event);
	// boot emits app_installed + app_started, then one per tracked sample
	await drained(sent, 2 + Object.keys(EVENT_SAMPLES).length);
	for (const entry of allEntries(sent)) {
		const plainKeys = Object.keys(entry.properties)
			.filter((key) => !key.startsWith("$"))
			.sort();
		const expected = EXPECTED_KEYS[entry.event as keyof typeof EXPECTED_KEYS];
		expect(expected).toBeDefined();
		expect(plainKeys).toEqual([...expected].sort());
		// PostHog framing: personless (no person profiles) + GeoIP disabled — on EVERY event.
		expect(entry.properties.$process_person_profile).toBe(false);
		expect(entry.properties.$geoip_disable).toBe(true);
	}
});

test("every event is stamped with the env metadata", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	track({ name: "app_started" });
	await drained(sent, 3);
	const entry = allEntries(sent).at(-1);
	expect(entry?.properties).toMatchObject({ app_version: "1.2.3", channel: "stable" });
	expect(entry?.properties.os).toBeString();
	expect(entry?.properties.arch).toBeString();
});

test("the batch goes to the EU cloud by default; THINKRAIL_POSTHOG_HOST retargets it", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	await drained(sent, 1);
	expect(sent[0]?.url).toBe("https://eu.i.posthog.com/batch/");

	resetAnalyticsForTests();
	process.env.THINKRAIL_POSTHOG_HOST = "https://ph.example.test/"; // trailing slash normalized
	const retargeted: SentPayload[] = [];
	bootReleaseLike(retargeted);
	await drained(retargeted, 1);
	expect(retargeted[0]?.url).toBe("https://ph.example.test/batch/");
});

test("shutdownAnalytics genuinely awaits the drain (slow transport, no polling) and never throws", async () => {
	const sent: SentPayload[] = [];
	const slowFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
		await Bun.sleep(50); // a real network-ish delay — an unawaited drain could not see this land
		sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return new Response("{}", { status: 200 });
	}) as typeof fetch;
	bootReleaseLike(sent, { fetchImpl: slowFetch });
	track({ name: "chat_started", params: { provider: "anthropic", model: "m" } });
	await shutdownAnalytics();
	// Asserted immediately after the await — deliverable only because shutdown really waited.
	expect(allEntries(sent).map((e) => e.event)).toEqual([
		"app_installed",
		"app_started",
		"chat_started",
	]);
	await shutdownAnalytics(); // idempotent (memoized), still never throws
});

test("toggle-off silences events already queued inside the SDK — the transport gate", async () => {
	const delivered: SentPayload[] = [];
	let started = 0;
	const slowFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
		started++;
		await Bun.sleep(100); // keep this request in-flight while the next event queues behind it
		delivered.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return new Response("{}", { status: 200 });
	}) as typeof fetch;
	bootReleaseLike(delivered, { fetchImpl: slowFetch });
	await drained(delivered, 2); // boot lifecycle out of the way

	const startedBefore = started;
	track({ name: "chat_started", params: { provider: "anthropic", model: "m" } });
	const deadline = Date.now() + 2_000;
	while (started === startedBefore && Date.now() < deadline) await Bun.sleep(5);
	expect(started).toBeGreaterThan(startedBefore); // chat_started is genuinely ON the wire…

	track({ name: "provider_login", params: { provider: "openai", method: "oauth" } }); // …this one queues behind it
	setAnalyticsSending(false); // consent off while one is in-flight and one is queued
	await shutdownAnalytics(); // drains the queue — into the closed gate
	await Bun.sleep(150); // let the in-flight request finish

	const events = allEntries(delivered).map((e) => e.event);
	expect(events).toContain("chat_started"); // already on the wire — cannot be recalled
	expect(events).not.toContain("provider_login"); // queued — died at the gate, zero network
});

// ── installation identity ──────────────────────────────────────────────

test("the install id is minted once, used as distinct_id, and NEVER rotated by toggles", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	await drained(sent, 1);
	const id = ensureInstallation().id;
	expect(allEntries(sent)[0]?.distinct_id).toBe(id);

	setAnalyticsSending(false);
	setAnalyticsSending(true);
	track({ name: "app_started" });
	await drained(sent, 3);
	expect(allEntries(sent).at(-1)?.distinct_id).toBe(id);
	expect(ensureInstallation().id).toBe(id); // unchanged on disk too
});

test("app_installed fires exactly once per install (announced bit survives restarts)", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	await drained(sent, 2);
	expect(allEntries(sent).map((e) => e.event)).toEqual(["app_installed", "app_started"]);

	// Simulated restart: same data dir, fresh in-memory state.
	resetAnalyticsForTests();
	const sentAfterRestart: SentPayload[] = [];
	bootReleaseLike(sentAfterRestart);
	await drained(sentAfterRestart, 1);
	await settled();
	expect(allEntries(sentAfterRestart).map((e) => e.event)).toEqual(["app_started"]);
});

test("a disabled boot mints the id but sends nothing; enabling later announces once", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent, { enabled: false });
	await settled();
	expect(sent).toHaveLength(0);
	expect(readFileSync(join(dataDir, "installation.json"), "utf8")).toContain('"announced": false');

	setAnalyticsSending(true);
	await drained(sent, 1);
	expect(allEntries(sent).map((e) => e.event)).toEqual(["app_installed"]);
	setAnalyticsSending(true); // idempotent — no second announce
	await settled();
	expect(allEntries(sent)).toHaveLength(1);
});

// ── gates ──────────────────────────────────────────────────────────────

test("the dev channel refuses a baked key — a dev run never sends", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent, { channel: "dev" });
	track({ name: "app_started" });
	await settled();
	expect(sent).toHaveLength(0);
});

test("a THINKRAIL_POSTHOG_API_KEY env var is IGNORED — a dev run has no path to the network", async () => {
	process.env.THINKRAIL_POSTHOG_API_KEY = "phc_ENV";
	const sent: SentPayload[] = [];
	initializeAnalytics({ channel: "dev", enabled: true, fetchImpl: makeFetch(sent) });
	track({ name: "app_started" });
	await settled();
	expect(sent).toHaveLength(0);
});

test("an unknown channel fails closed — only stable/nightly ever send", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent, { channel: "beta" });
	track({ name: "app_started" });
	await settled();
	expect(sent).toHaveLength(0);

	resetAnalyticsForTests();
	const nightly: SentPayload[] = [];
	bootReleaseLike(nightly, { channel: "nightly" });
	await drained(nightly, 2); // nightly is a release channel — it sends
});

test("--no-analytics (mute) silences the run even when key + config say send", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent, { mute: true });
	track({ name: "app_started" });
	setAnalyticsSending(true); // a settings toggle during a muted run must not unmute it
	track({ name: "app_started" });
	await settled();
	expect(sent).toHaveLength(0);
});

test("setAnalyticsSending(false) stops sending immediately", async () => {
	const sent: SentPayload[] = [];
	bootReleaseLike(sent);
	await drained(sent, 2); // let the boot lifecycle land first…
	sent.length = 0; // …then drop it
	setAnalyticsSending(false);
	track({ name: "chat_started", params: { provider: "anthropic", model: "m" } });
	await settled();
	expect(sent).toHaveLength(0);
});

test("track never throws into the caller, even when the transport does", async () => {
	initializeAnalytics({
		channel: "stable",
		posthogApiKey: "phc_TEST",
		enabled: true,
		fetchImpl: (() => {
			throw new Error("boom");
		}) as unknown as typeof fetch,
	});
	expect(() => track({ name: "app_started" })).not.toThrow();
	await settled(); // let the SDK's internal retry/error path run inside the test's lifetime
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
