import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAttributionClaim } from "./attribution";
import {
	getAdditionalAnalyticsCapture,
	initializeAnalytics,
	resetAnalyticsForTests,
	setAdditionalAnalyticsEnabled,
	shutdownAnalytics,
	startAttributionClaim,
	track,
} from "./service";

const claimId = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const bridgeId = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
const journeyId = "123e4567-e89b-42d3-a456-426614174000";
let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

interface CapturedEvent {
	event: string;
	properties: Record<string, unknown>;
}

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
}

function redeemed(now: number) {
	return {
		journey_id: journeyId,
		bridge_id: bridgeId,
		first_touch: {
			source: "newsletter",
			medium: "email",
			campaign: "launch",
			content: "hero",
			referrer_class: "referral",
			landing_content_key: "landing",
			touched_at: now - 2_000,
			policy_version: 1,
		},
		last_touch: {
			source: "search",
			medium: "organic",
			campaign: "launch",
			content: "article",
			referrer_class: "search",
			landing_content_key: "blog/index",
			touched_at: now - 1_000,
			policy_version: 1,
		},
	};
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-attribution-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetAnalyticsForTests();
});

afterEach(async () => {
	await shutdownAnalytics();
	resetAnalyticsForTests();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function analyticsFetch(events: CapturedEvent[]): typeof fetch {
	return (async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
		events.push(...JSON.parse(String(init?.body)).batch);
		return json({});
	}) as typeof fetch;
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!predicate() && Date.now() < deadline) await Bun.sleep(5);
	expect(predicate()).toBe(true);
}

test("a packaged confirmed grant claims once, links once, and persists only normalized campaign context", async () => {
	const events: CapturedEvent[] = [];
	const scheduled: Array<() => void> = [];
	const opened: string[] = [];
	const requests: Array<{ path: string; body: Record<string, string> }> = [];
	let expectedChallenge = "";
	const now = Date.now();
	const attributionFetch: typeof fetch = (async (
		url: Parameters<typeof fetch>[0],
		init?: RequestInit,
	) => {
		const parsed = new URL(String(url));
		const body = JSON.parse(String(init?.body)) as Record<string, string>;
		requests.push({ path: parsed.pathname, body });
		if (parsed.pathname === "/api/attribution/claims") {
			expectedChallenge = body.challenge ?? "";
			return json(
				{
					claim_id: claimId,
					claim_url: `/attribution/claim/?id=${claimId}`,
					expires_at: now + 60_000,
				},
				201,
			);
		}
		const challenge = createHash("sha256")
			.update(body.verifier ?? "", "utf8")
			.digest("base64url");
		expect(challenge).toBe(expectedChallenge);
		if (parsed.pathname.endsWith("/status")) return json({ status: "bound" });
		if (parsed.pathname.endsWith("/redeem")) return json(redeemed(now));
		throw new Error("unexpected attribution request");
	}) as typeof fetch;

	initializeAnalytics({
		build: "binary",
		additionalEnabled: true,
		env: {},
		fetchImpl: analyticsFetch(events),
		attributionEndpoint: "http://127.0.0.1:4567",
		attributionFetch,
		attributionSleep: async () => {},
		attributionSchedule: (run) => scheduled.push(run),
		openExternal: (url) => {
			opened.push(url);
			return new Promise<void>(() => {});
		},
	});
	startAttributionClaim();
	expect(scheduled).toHaveLength(1);
	expect(existsSync(join(dataDir, "attribution.json"))).toBe(false);
	scheduled[0]?.();
	await waitFor(() => events.some((event) => event.event === "acquisition_linked"));

	expect(opened).toEqual([`http://127.0.0.1:4567/attribution/claim/?id=${claimId}`]);
	expect(requests.map((request) => request.path)).toEqual([
		"/api/attribution/claims",
		`/api/attribution/claims/${claimId}/status`,
		`/api/attribution/claims/${claimId}/redeem`,
	]);
	const stored = JSON.parse(readFileSync(join(dataDir, "attribution.json"), "utf8"));
	expect(stored).toEqual({
		first_touch: redeemed(now).first_touch,
		last_touch: redeemed(now).last_touch,
	});
	const serialized = JSON.stringify(stored);
	for (const forbidden of [journeyId, bridgeId, claimId, "verifier", "challenge", "claim_url"]) {
		expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
	}

	const firstStart = events.find((event) => event.event === "app_started");
	expect(firstStart?.properties).not.toHaveProperty("first_touch_source");
	const linked = events.find((event) => event.event === "acquisition_linked");
	expect(linked?.properties).toMatchObject({
		journey_id: journeyId,
		bridge_id: bridgeId,
		first_touch_source: "newsletter",
		last_touch_source: "search",
	});
	track({
		name: "message_sent",
		params: { mode: "prompt", provider: "openai", auth_method: "api_key" },
	});
	setAdditionalAnalyticsEnabled(false);
	track({
		name: "message_sent",
		params: { mode: "prompt", provider: "openai", auth_method: "api_key" },
	});
	setAdditionalAnalyticsEnabled(true);
	track({
		name: "message_sent",
		params: { mode: "prompt", provider: "openai", auth_method: "api_key" },
	});
	getAdditionalAnalyticsCapture()?.({
		name: "task_completed",
		params: { change_evidence: "changes", verification_recorded: "yes" },
	});
	startAttributionClaim();
	expect(scheduled).toHaveLength(2);
	scheduled[1]?.();
	await shutdownAnalytics();
	const messages = events.filter((event) => event.event === "message_sent");
	expect(messages).toHaveLength(3);
	expect(messages[0]?.properties.first_touch_source).toBe("newsletter");
	expect(messages[1]?.properties).not.toHaveProperty("first_touch_source");
	expect(messages[2]?.properties.first_touch_source).toBe("newsletter");
	expect(messages.every((event) => !("journey_id" in event.properties))).toBe(true);
	expect(messages.every((event) => !("bridge_id" in event.properties))).toBe(true);
	const laterAdditional = events.find((event) => event.event === "task_completed");
	expect(laterAdditional?.properties).toMatchObject({
		first_touch_source: "newsletter",
		last_touch_source: "search",
	});
	expect(laterAdditional?.properties).not.toHaveProperty("journey_id");
	expect(laterAdditional?.properties).not.toHaveProperty("bridge_id");
	expect(requests).toHaveLength(3);

	resetAnalyticsForTests();
	const restartEvents: CapturedEvent[] = [];
	initializeAnalytics({
		build: "binary",
		additionalEnabled: true,
		env: {},
		fetchImpl: analyticsFetch(restartEvents),
	});
	await shutdownAnalytics();
	const restarted = restartEvents.find((event) => event.event === "app_started");
	expect(restarted?.properties).toMatchObject({
		first_touch_source: "newsletter",
		last_touch_source: "search",
	});
	expect(restartEvents.some((event) => event.event === "acquisition_linked")).toBe(false);
});

test("a never-settling request is aborted by its finite timeout", async () => {
	let requestSignal: AbortSignal | undefined;
	const started = Date.now();
	await runAttributionClaim({
		endpoint: "http://127.0.0.1:4567",
		fetchImpl: ((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
			requestSignal = init?.signal as AbortSignal;
			return new Promise<Response>(() => {});
		}) as typeof fetch,
		openExternal: () => {},
		active: () => true,
		persist: () => {},
		linked: () => {},
		requestTimeoutMs: 20,
		overallDeadlineMs: 200,
	});
	expect(Date.now() - started).toBeLessThan(500);
	expect(requestSignal?.aborted).toBe(true);
});

test.each([
	["wrong content type", { "Content-Type": "text/html" }],
	["declared oversized body", { "Content-Type": "application/json", "Content-Length": "16385" }],
] as const)("cancels a %s response body before returning", async (_, headers) => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		cancel() {
			cancelled = true;
		},
	});
	await runAttributionClaim({
		endpoint: "http://127.0.0.1:4567",
		fetchImpl: (async () =>
			new Response(body, { status: 201, headers })) as unknown as typeof fetch,
		openExternal: () => {},
		active: () => true,
		persist: () => {},
		linked: () => {},
		requestTimeoutMs: 20,
		overallDeadlineMs: 200,
	});
	expect(cancelled).toBe(true);
});

test("revocation aborts a never-settling generation and the consumed attempt never retries", async () => {
	const scheduled: Array<() => void> = [];
	let requestSignal: AbortSignal | undefined;
	let requests = 0;
	let opens = 0;
	initializeAnalytics({
		build: "binary",
		additionalEnabled: true,
		env: {},
		fetchImpl: analyticsFetch([]),
		attributionEndpoint: "http://127.0.0.1:4567",
		attributionFetch: ((_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
			requests++;
			requestSignal = init?.signal as AbortSignal;
			return new Promise<Response>(() => {});
		}) as typeof fetch,
		attributionSchedule: (run) => scheduled.push(run),
		openExternal: () => {
			opens++;
		},
	});
	startAttributionClaim();
	scheduled[0]?.();
	await waitFor(() => requests === 1);
	setAdditionalAnalyticsEnabled(false);
	await waitFor(() => requestSignal?.aborted === true);
	expect(opens).toBe(0);
	setAdditionalAnalyticsEnabled(true);
	startAttributionClaim();
	expect(scheduled).toHaveLength(2);
	scheduled[1]?.();
	await Bun.sleep(5);
	expect(requests).toBe(1);
});

test("redeem activates memory and emits linked when terminal persistence replacement fails", async () => {
	const events: CapturedEvent[] = [];
	const scheduled: Array<() => void> = [];
	const now = Date.now();
	const attributionFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0]) => {
		const path = new URL(String(url)).pathname;
		if (path === "/api/attribution/claims") {
			return json(
				{
					claim_id: claimId,
					claim_url: `/attribution/claim/?id=${claimId}`,
					expires_at: now + 60_000,
				},
				201,
			);
		}
		if (path.endsWith("/status")) return json({ status: "bound" });
		if (path.endsWith("/redeem")) return json(redeemed(now));
		throw new Error("unexpected attribution request");
	}) as typeof fetch;
	initializeAnalytics({
		build: "binary",
		additionalEnabled: true,
		env: {},
		fetchImpl: analyticsFetch(events),
		attributionEndpoint: "http://127.0.0.1:4567",
		attributionFetch,
		attributionSleep: async () => {},
		attributionSchedule: (run) => scheduled.push(run),
		attributionPersist: () => {
			throw new Error("disk full");
		},
		openExternal: () => {},
	});
	startAttributionClaim();
	scheduled[0]?.();
	await waitFor(() => events.some((event) => event.event === "acquisition_linked"));
	track({
		name: "message_sent",
		params: { mode: "prompt", provider: "openai", auth_method: "api_key" },
	});
	await shutdownAnalytics();

	expect(events.filter((event) => event.event === "acquisition_linked")).toHaveLength(1);
	expect(events.find((event) => event.event === "message_sent")?.properties).toMatchObject({
		first_touch_source: "newsletter",
		last_touch_source: "search",
	});
	expect(readFileSync(join(dataDir, "attribution.json"), "utf8")).toContain(
		'"browserClaimAttempted": true',
	);
});

test("pending status polling is capped at twenty requests and never opens twice", async () => {
	const scheduled: Array<() => void> = [];
	let opens = 0;
	let statuses = 0;
	const attributionFetch: typeof fetch = (async (url: Parameters<typeof fetch>[0]) => {
		const path = new URL(String(url)).pathname;
		if (path === "/api/attribution/claims") {
			return json(
				{
					claim_id: claimId,
					claim_url: `/attribution/claim/?id=${claimId}`,
					expires_at: Date.now() + 60_000,
				},
				201,
			);
		}
		if (path.endsWith("/status")) {
			statuses++;
			return json({ error: "pending" }, 409);
		}
		throw new Error("redeem must not run");
	}) as typeof fetch;
	initializeAnalytics({
		build: "desktop",
		additionalEnabled: true,
		env: {},
		fetchImpl: analyticsFetch([]),
		attributionEndpoint: "http://127.0.0.1:4567",
		attributionFetch,
		attributionSleep: async () => {},
		attributionSchedule: (run) => scheduled.push(run),
		openExternal: () => {
			opens++;
		},
	});
	startAttributionClaim();
	scheduled[0]?.();
	await waitFor(() => statuses === 20);
	expect(opens).toBe(1);
	expect(statuses).toBe(20);
	expect(readFileSync(join(dataDir, "attribution.json"), "utf8")).toContain(
		'"browserClaimAttempted": true',
	);
});

test.each([
	{ label: "source", build: "source" as const, additionalEnabled: true, opener: true, env: {} },
	{ label: "off", build: "binary" as const, additionalEnabled: false, opener: true, env: {} },
	{ label: "no opener", build: "binary" as const, additionalEnabled: true, opener: false, env: {} },
	{
		label: "environment suppression",
		build: "binary" as const,
		additionalEnabled: true,
		opener: true,
		env: { THINKRAIL_NO_ANALYTICS: "1" },
	},
])("$label skips without consuming the attempt", ({ build, additionalEnabled, opener, env }) => {
	const scheduled: Array<() => void> = [];
	initializeAnalytics({
		build,
		additionalEnabled,
		env,
		fetchImpl: analyticsFetch([]),
		attributionSchedule: (run) => scheduled.push(run),
		...(opener ? { openExternal: () => {} } : {}),
	});
	startAttributionClaim();
	expect(scheduled).toEqual([]);
	expect(existsSync(join(dataDir, "attribution.json"))).toBe(false);
});
