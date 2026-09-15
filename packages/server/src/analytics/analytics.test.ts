import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { ensureInstallation } from "../persistence";
import {
	type AdditionalAnalyticsEvent,
	type AnalyticsEvent,
	type BasicAnalyticsEvent,
	bucketCount,
	bucketDuration,
	bucketProvider,
	bucketProviderModel,
	CUSTOM_BUCKET,
} from "./events";
import {
	getAdditionalAnalyticsCapture,
	initializeAnalytics,
	resetAnalyticsForTests,
	setAdditionalAnalyticsEnabled,
	shutdownAnalytics,
	track,
} from "./service";
import { POSTHOG_PROJECT_KEY } from "./sink";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-analytics-test-"));
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
	return ((url: Parameters<typeof fetch>[0], init?: RequestInit) => {
		sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return Promise.resolve(new Response("{}", { status: 200 }));
	}) as typeof fetch;
}

function allEntries(sent: SentPayload[]): BatchEntry[] {
	return sent.flatMap((p) => p.body.batch);
}

function boot(
	sent: SentPayload[],
	overrides: Partial<Parameters<typeof initializeAnalytics>[0]> = {},
): void {
	initializeAnalytics({
		appVersion: "1.2.3",
		channel: "stable",
		build: "binary",
		additionalEnabled: false,
		env: {},
		fetchImpl: makeFetch(sent),
		...overrides,
	});
}

const BASIC_EVENTS = {
	app_started: { name: "app_started" },
	chat_started: {
		name: "chat_started",
		params: { provider: "anthropic", model: "some-model", auth_method: "subscription" },
	},
	message_sent: {
		name: "message_sent",
		params: { mode: "prompt", provider: "openai", auth_method: "api_key" },
	},
	provider_login: {
		name: "provider_login",
		params: { provider: "openai-codex", method: "oauth", auth_method: "subscription" },
	},
} as const satisfies {
	[K in BasicAnalyticsEvent["name"]]: Extract<BasicAnalyticsEvent, { name: K }>;
};

const RUN = {
	origin: "user",
	workspace_kind: "managed",
	provider: "openai",
	model: "custom",
} as const;
const ADDITIONAL_EVENTS = {
	setup_state_observed: {
		name: "setup_state_observed",
		params: { provider_available: "yes", model_available: "yes", project_present: "no" },
	},
	setup_action_finished: {
		name: "setup_action_finished",
		params: { action: "project_open", outcome: "succeeded", reason: "none" },
	},
	agent_run_started: { name: "agent_run_started", params: RUN },
	agent_run_settled: {
		name: "agent_run_settled",
		params: {
			...RUN,
			outcome: "normal_stop",
			duration_bucket: "10–59s",
			retry_bucket: "0",
			compaction_bucket: "1",
		},
	},
	task_completed: {
		name: "task_completed",
		params: { change_evidence: "commit", verification_recorded: "yes" },
	},
	review_decided: { name: "review_decided", params: { actor: "agent", verdict: "approved" } },
	pr_action_finished: {
		name: "pr_action_finished",
		params: { action: "created", outcome: "succeeded", reason: "none" },
	},
} as const satisfies {
	[K in AdditionalAnalyticsEvent["name"]]: Extract<AdditionalAnalyticsEvent, { name: K }>;
};

const ENV_KEYS = ["app_version", "channel", "os", "arch", "build"];
const RUN_KEYS = ["origin", "workspace_kind", "provider", "model"];
const EXPECTED_KEYS: Record<AnalyticsEvent["name"], string[]> = {
	app_started: ENV_KEYS,
	chat_started: [...ENV_KEYS, "provider", "model", "auth_method"],
	message_sent: [...ENV_KEYS, "mode", "provider", "auth_method"],
	provider_login: [...ENV_KEYS, "provider", "method", "auth_method"],
	setup_state_observed: [...ENV_KEYS, "provider_available", "model_available", "project_present"],
	setup_action_finished: [...ENV_KEYS, "action", "outcome", "reason"],
	agent_run_started: [...ENV_KEYS, ...RUN_KEYS],
	agent_run_settled: [
		...ENV_KEYS,
		...RUN_KEYS,
		"outcome",
		"duration_bucket",
		"retry_bucket",
		"compaction_bucket",
	],
	task_completed: [...ENV_KEYS, "change_evidence", "verification_recorded"],
	review_decided: [...ENV_KEYS, "actor", "verdict"],
	pr_action_finished: [...ENV_KEYS, "action", "outcome", "reason"],
};

test("every event has exactly its closed properties plus personless transport framing", async () => {
	const sent: SentPayload[] = [];
	boot(sent, { additionalEnabled: true });
	for (const event of Object.values(BASIC_EVENTS)) track(event);
	const capture = getAdditionalAnalyticsCapture();
	expect(capture).not.toBeNull();
	for (const event of Object.values(ADDITIONAL_EVENTS)) capture?.(event);
	await shutdownAnalytics();
	const entries = allEntries(sent);
	expect(entries).toHaveLength(1 + Object.keys(EXPECTED_KEYS).length);
	for (const entry of entries) {
		const expected = EXPECTED_KEYS[entry.event as AnalyticsEvent["name"]];
		expect(expected).toBeDefined();
		expect(
			Object.keys(entry.properties)
				.filter((k) => !k.startsWith("$"))
				.sort(),
		).toEqual([...expected].sort());
		expect(entry.properties.$process_person_profile).toBe(false);
		expect(entry.properties.$geoip_disable).toBe(true);
	}
});

test.each([
	false,
	true,
])("all existing basic events send with additionalEnabled=%s", async (enabled) => {
	const sent: SentPayload[] = [];
	boot(sent, { additionalEnabled: enabled });
	for (const event of Object.values(BASIC_EVENTS)) track(event);
	await shutdownAnalytics();
	expect(allEntries(sent).map((e) => e.event)).toEqual([
		"app_started",
		...Object.keys(BASIC_EVENTS),
	]);
});

test.each([
	"api_key",
	"subscription",
	"oauth",
	"central",
	"other",
	"unknown",
] as const)("auth_method=%s remains basic metadata without additional consent", async (auth_method) => {
	const sent: SentPayload[] = [];
	boot(sent, { additionalEnabled: false });
	track({ name: "chat_started", params: { provider: "anthropic", model: "custom", auth_method } });
	track({ name: "message_sent", params: { mode: "prompt", provider: "anthropic", auth_method } });
	track({
		name: "provider_login",
		params: { provider: "anthropic", method: "oauth", auth_method },
	});
	await shutdownAnalytics();
	const entries = allEntries(sent).filter((entry) => entry.event !== "app_started");
	expect(entries).toHaveLength(3);
	expect(entries.every((entry) => entry.properties.auth_method === auth_method)).toBe(true);
});

test("there is no additional capture before consent and no replay when enabled", async () => {
	const sent: SentPayload[] = [];
	boot(sent);
	expect(getAdditionalAnalyticsCapture()).toBeNull();
	setAdditionalAnalyticsEnabled(true);
	await shutdownAnalytics();
	expect(allEntries(sent).map((e) => e.event)).toEqual(["app_started"]);
});

test("a grant stays stable until revoked, and old captures never revive", async () => {
	const sent: SentPayload[] = [];
	boot(sent, { additionalEnabled: true });
	const first = getAdditionalAnalyticsCapture();
	setAdditionalAnalyticsEnabled(true);
	expect(getAdditionalAnalyticsCapture()).toBe(first);
	setAdditionalAnalyticsEnabled(false);
	expect(getAdditionalAnalyticsCapture()).toBeNull();
	setAdditionalAnalyticsEnabled(true);
	const second = getAdditionalAnalyticsCapture();
	expect(second).not.toBe(first);
	first?.(ADDITIONAL_EVENTS.task_completed);
	second?.(ADDITIONAL_EVENTS.review_decided);
	track(BASIC_EVENTS.message_sent);
	await shutdownAnalytics();
	expect(
		allEntries(sent)
			.map((e) => e.event)
			.sort(),
	).toEqual(["app_started", "message_sent", "review_decided"]);
});

test.each([
	false,
	true,
])("revocation drops queued data even during shutdown=%s", async (duringShutdown) => {
	const sent: SentPayload[] = [];
	let release: (() => void) | undefined;
	let started = false;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const fetchImpl: typeof fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
		const body = JSON.parse(String(init?.body));
		if (body.batch.some((e: BatchEntry) => e.event === "agent_run_started")) {
			started = true;
			await blocked;
		}
		sent.push({ url: String(url), body });
		return new Response("{}", { status: 200 });
	}) as typeof fetch;
	boot(sent, { additionalEnabled: true, fetchImpl });
	const oldCapture = getAdditionalAnalyticsCapture();
	oldCapture?.(ADDITIONAL_EVENTS.agent_run_started);
	const deadline = Date.now() + 2_000;
	while (!started && Date.now() < deadline) await Bun.sleep(5);
	expect(started).toBe(true);
	oldCapture?.(ADDITIONAL_EVENTS.task_completed);
	track(BASIC_EVENTS.message_sent);
	const stopping = duringShutdown ? shutdownAnalytics() : null;
	setAdditionalAnalyticsEnabled(false);
	setAdditionalAnalyticsEnabled(true);
	getAdditionalAnalyticsCapture()?.(ADDITIONAL_EVENTS.review_decided);
	release?.();
	await (stopping ?? shutdownAnalytics());
	const events = allEntries(sent).map((e) => e.event);
	expect(events).toContain("agent_run_started");
	if (duringShutdown) expect(events).not.toContain("review_decided");
	else expect(events).toContain("review_decided");
	expect(events).toContain("message_sent");
	expect(events).not.toContain("task_completed");
});

test("failed additional requests do not retry on the network after revoke/regrant", async () => {
	let attempts = 0;
	const sent: SentPayload[] = [];
	const fetchImpl: typeof fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
		const body = JSON.parse(String(init?.body));
		if (body.batch.some((e: BatchEntry) => e.event === "task_completed")) {
			attempts++;
			setAdditionalAnalyticsEnabled(false);
			setAdditionalAnalyticsEnabled(true);
			return new Response("{}", { status: 503 });
		}
		sent.push({ url: String(url), body });
		return new Response("{}", { status: 200 });
	}) as typeof fetch;
	boot(sent, { additionalEnabled: true, fetchImpl });
	getAdditionalAnalyticsCapture()?.(ADDITIONAL_EVENTS.task_completed);
	const deadline = Date.now() + 2_000;
	while (!attempts && Date.now() < deadline) await Bun.sleep(5);
	expect(attempts).toBe(1);
	getAdditionalAnalyticsCapture()?.(ADDITIONAL_EVENTS.review_decided);
	await shutdownAnalytics();
	expect(attempts).toBe(1);
	expect(allEntries(sent).map((e) => e.event)).toContain("review_decided");
});

test.each([
	"source",
	"binary",
	"desktop",
] as const)("%s stamps both tiers without a channel gate", async (build) => {
	const sent: SentPayload[] = [];
	boot(sent, { build, channel: "dev", additionalEnabled: true });
	getAdditionalAnalyticsCapture()?.(ADDITIONAL_EVENTS.task_completed);
	await shutdownAnalytics();
	expect(allEntries(sent)).toHaveLength(2);
	for (const entry of allEntries(sent)) {
		expect(entry.properties).toMatchObject({ app_version: "1.2.3", channel: "dev", build });
		expect(entry.properties.os).toBe(
			process.platform === "darwin"
				? "macos"
				: process.platform === "win32"
					? "windows"
					: process.platform,
		);
		expect(entry.properties.arch).toBe(process.arch);
	}
});

test("first launch replaces install announcements and identity survives CLI to desktop and consent changes", async () => {
	writeFileSync(
		join(dataDir, "installation.json"),
		JSON.stringify({ id: "existing-install", announced: true }),
	);
	const first: SentPayload[] = [];
	boot(first);
	setAdditionalAnalyticsEnabled(true);
	getAdditionalAnalyticsCapture()?.(ADDITIONAL_EVENTS.task_completed);
	await shutdownAnalytics();
	const desktop: SentPayload[] = [];
	boot(desktop, { build: "desktop" });
	await shutdownAnalytics();
	expect(ensureInstallation()).toEqual({ id: "existing-install" });
	expect(
		[...allEntries(first), ...allEntries(desktop)].every(
			(e) => e.distinct_id === "existing-install",
		),
	).toBe(true);
	expect(allEntries(desktop).map((e) => e.event)).toEqual(["app_started"]);
});

test("new identity has no announcement marker", async () => {
	const sent: SentPayload[] = [];
	boot(sent);
	await shutdownAnalytics();
	const record = JSON.parse(readFileSync(join(dataDir, "installation.json"), "utf8"));
	expect(Object.keys(record)).toEqual(["id"]);
	expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
	expect(allEntries(sent)[0]?.distinct_id).toBe(record.id);
});

test("EU destination and project key are shared, with an injectable endpoint", async () => {
	const sent: SentPayload[] = [];
	boot(sent);
	await shutdownAnalytics();
	expect(sent[0]?.url).toBe("https://eu.i.posthog.com/batch/");
	expect(sent[0]?.body.api_key).toBe(POSTHOG_PROJECT_KEY);
	const retargeted: SentPayload[] = [];
	boot(retargeted, { env: { THINKRAIL_POSTHOG_HOST: "http://127.0.0.1:4321/" } });
	await shutdownAnalytics();
	expect(retargeted[0]?.url).toBe("http://127.0.0.1:4321/batch/");
});

test.each([
	{ CI: "1" },
	{ NODE_ENV: "test" },
	{ CI: "1", THINKRAIL_NO_ANALYTICS: "1" },
])("automated environment %j sends neither tier", async (env) => {
	const sent: SentPayload[] = [];
	boot(sent, { additionalEnabled: true, env });
	setAdditionalAnalyticsEnabled(true);
	for (const event of Object.values(BASIC_EVENTS)) track(event);
	expect(getAdditionalAnalyticsCapture()).toBeNull();
	await shutdownAnalytics();
	expect(sent).toEqual([]);
});

test.each([
	{ mute: true },
	{ env: { THINKRAIL_NO_ANALYTICS: "1" } },
])("per-run suppression %j leaves basic reporting on", async (options) => {
	const sent: SentPayload[] = [];
	boot(sent, { ...options, additionalEnabled: true });
	setAdditionalAnalyticsEnabled(true);
	expect(getAdditionalAnalyticsCapture()).toBeNull();
	for (const event of Object.values(BASIC_EVENTS)) track(event);
	await shutdownAnalytics();
	expect(allEntries(sent)).toHaveLength(1 + Object.keys(BASIC_EVENTS).length);
});

test("shutdown drains both tiers once and prevents later capture/re-enabling", async () => {
	const sent: SentPayload[] = [];
	const realFetch = makeFetch(sent);
	boot(sent, {
		additionalEnabled: true,
		fetchImpl: (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
			await Bun.sleep(40);
			return realFetch(url, init);
		}) as typeof fetch,
	});
	const capture = getAdditionalAnalyticsCapture();
	capture?.(ADDITIONAL_EVENTS.task_completed);
	const first = shutdownAnalytics();
	expect(shutdownAnalytics()).toBe(first);
	track(BASIC_EVENTS.message_sent);
	capture?.(ADDITIONAL_EVENTS.review_decided);
	setAdditionalAnalyticsEnabled(true);
	expect(getAdditionalAnalyticsCapture()).toBeNull();
	await first;
	expect(
		allEntries(sent)
			.map((e) => e.event)
			.sort(),
	).toEqual(["app_started", "task_completed"]);
});

test("transport failure never throws into capture", async () => {
	const sent: SentPayload[] = [];
	boot(sent, {
		fetchImpl: ((_url: Parameters<typeof fetch>[0]): Promise<Response> => {
			throw new Error("offline");
		}) as typeof fetch,
	});
	expect(() => track(BASIC_EVENTS.message_sent)).not.toThrow();
	resetAnalyticsForTests();
	await Bun.sleep(25);
});

test("provider and model identity stays catalog-bucketed", () => {
	const model = getBuiltinModels("anthropic")[0];
	if (!model) throw new Error("pi catalog has no anthropic models");
	expect(bucketProviderModel("anthropic", model.id)).toEqual({
		provider: "anthropic",
		model: model.id,
	});
	expect(bucketProvider("anthropic")).toBe("anthropic");
	expect(bucketProviderModel("private-provider", "private-model")).toEqual({
		provider: CUSTOM_BUCKET,
		model: CUSTOM_BUCKET,
	});
	expect(bucketProvider("private-provider")).toBe(CUSTOM_BUCKET);
	expect(bucketProviderModel("openai", "private-model")).toEqual({
		provider: "openai",
		model: CUSTOM_BUCKET,
	});
});

test("duration and recovery buckets have fixed boundaries and reject invalid measurements", () => {
	expect(
		[0, 9999, 10000, 59999, 60000, 299999, 300000, 899999, 900000, -1, Number.NaN].map(
			bucketDuration,
		),
	).toEqual([
		"<10s",
		"<10s",
		"10–59s",
		"10–59s",
		"1–4m",
		"1–4m",
		"5–14m",
		"5–14m",
		"15m+",
		"unknown",
		"unknown",
	]);
	expect([0, 1, 2, 4, 5, -1, 0.5, Number.NaN].map(bucketCount)).toEqual([
		"0",
		"1",
		"2–4",
		"2–4",
		"5+",
		"unknown",
		"unknown",
		"unknown",
	]);
});
