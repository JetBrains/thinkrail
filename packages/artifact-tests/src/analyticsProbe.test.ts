import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	analyticsProbeEnvironment,
	assertDesktopLaunch,
	type CollectedEvent,
	startAnalyticsCollector,
} from "./analyticsProbe";

const expected = { app_version: "1.2.3", channel: "canary", os: "macos", arch: "arm64" };
const launch: CollectedEvent = {
	event: "app_started",
	distinct_id: "fe115e45-f8ed-48d7-b6e8-0f73a7fb54df",
	properties: {
		...expected,
		build: "desktop",
		$process_person_profile: false,
		$geoip_disable: true,
	},
};

const inherited = {
	CI: "1",
	ci: "true",
	NODE_ENV: "test",
	node_env: "test",
	THINKRAIL_NO_ANALYTICS: "1",
	thinkrail_no_analytics: "1",
	thinkrail_posthog_host: "https://production.invalid",
	Home: "real-home",
	UserProfile: "real-home",
	pi_coding_agent_dir: "real-agent",
	https_proxy: "https://proxy.invalid",
	all_proxy: "https://proxy.invalid",
	PATH: "test-path",
};

test("the human probe removes automated and optional mutes without inheriting real state or a vendor endpoint", () => {
	const env = analyticsProbeEnvironment("isolated", "http://127.0.0.1:12345", {}, inherited);
	for (const key of Object.keys(inherited).filter((key) => key !== "PATH")) {
		expect(env[key]).not.toBe(inherited[key as keyof typeof inherited]);
	}
	expect(env.CI).toBeUndefined();
	expect(env.NODE_ENV).toBeUndefined();
	expect(env.THINKRAIL_NO_ANALYTICS).toBeUndefined();
	expect(env.THINKRAIL_POSTHOG_HOST).toBe("http://127.0.0.1:12345");
	expect(env.HOME).toBe(join("isolated", "home"));
	expect(env.USERPROFILE).toBe(env.HOME);
	expect(env.THINKRAIL_DATA_DIR).toBe(join("isolated", "data"));
	expect(env.PI_CODING_AGENT_DIR).toBe(join("isolated", "agent"));
	expect(env.PATH).toBe("test-path");
});

test("each controlled mute is tested alone and cannot override isolation or the collector", () => {
	for (const mute of ["CI", "NODE_ENV", "THINKRAIL_NO_ANALYTICS"]) {
		const value = mute === "NODE_ENV" ? "test" : "1";
		const env = analyticsProbeEnvironment(
			"isolated",
			"http://127.0.0.1:12345",
			{ [mute]: value, HOME: "real-home", THINKRAIL_POSTHOG_HOST: "https://production.invalid" },
			inherited,
		);
		expect(env[mute]).toBe(value);
		for (const other of ["CI", "NODE_ENV", "THINKRAIL_NO_ANALYTICS"].filter(
			(key) => key !== mute,
		)) {
			expect(env[other]).toBeUndefined();
		}
		expect(env.HOME).toBe(join("isolated", "home"));
		expect(env.THINKRAIL_POSTHOG_HOST).toBe("http://127.0.0.1:12345");
	}
});

test("analytics probe refuses non-loopback collection", () => {
	for (const origin of ["https://eu.i.posthog.com", "http://0.0.0.0:1234", "http://127.0.0.1"]) {
		expect(() => analyticsProbeEnvironment("isolated", origin)).toThrow("loopback collector");
	}
});

test("desktop launch assertion pins baseline-only personless provenance", () => {
	expect(assertDesktopLaunch([launch], expected)).toBe(launch.distinct_id);
	for (const event of ["app_installed", "setup_state_observed"]) {
		expect(() => assertDesktopLaunch([launch, { ...launch, event }], expected)).toThrow(
			"only app_started",
		);
	}
	for (const key of [
		"app_version",
		"channel",
		"os",
		"arch",
		"build",
		"$process_person_profile",
		"$geoip_disable",
	]) {
		expect(() =>
			assertDesktopLaunch(
				[{ ...launch, properties: { ...launch.properties, [key]: "wrong" } }],
				expected,
			),
		).toThrow();
	}
	expect(() => assertDesktopLaunch([], expected)).toThrow("only app_started");
	expect(() => assertDesktopLaunch([{ ...launch, distinct_id: "not-a-uuid" }], expected)).toThrow(
		"UUID",
	);
	expect(() =>
		assertDesktopLaunch(
			[{ ...launch, properties: { ...launch.properties, path: "private" } }],
			expected,
		),
	).toThrow("properties");
});

test("loopback collector observes actual HTTP PostHog batches and records invalid requests", async () => {
	const collector = startAnalyticsCollector();
	try {
		const response = await fetch(`${collector.origin}/batch/`, {
			method: "POST",
			body: JSON.stringify({ api_key: "test-key", batch: [launch] }),
		});
		expect(response.ok).toBe(true);
		expect(collector.requests).toBe(1);
		expect(collector.events).toEqual([launch]);
		expect(collector.errors).toEqual([]);
		await fetch(`${collector.origin}/batch/`, { method: "POST", body: "not JSON" });
		expect(collector.requests).toBe(2);
		expect(collector.errors).toHaveLength(1);
	} finally {
		await collector.stop();
	}
});
