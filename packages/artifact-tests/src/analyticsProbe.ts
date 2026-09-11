import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTree } from "@thinkrail/shared/removeTree";
import { channel, version } from "@thinkrail/shared/version";
import {
	type ArtifactHostAdapter,
	hostEnvironment,
	type RunningArtifactHost,
} from "./artifactProbes";

export interface CollectedEvent {
	event: string;
	distinct_id: string;
	properties: Record<string, unknown>;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function startAnalyticsCollector() {
	const events: CollectedEvent[] = [];
	const errors: unknown[] = [];
	let requests = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			requests += 1;
			try {
				assert(request.method === "POST", "collector expected POST");
				assert(new URL(request.url).pathname === "/batch/", "collector expected /batch/");
				const body: unknown = await request.json();
				assert(isRecord(body) && Array.isArray(body.batch), "collector expected a PostHog batch");
				assert(typeof body.api_key === "string" && body.api_key.length > 0, "missing project key");
				for (const entry of body.batch) {
					assert(isRecord(entry), "invalid batch entry");
					assert(typeof entry.event === "string", "missing event name");
					assert(typeof entry.distinct_id === "string", "missing installation id");
					assert(isRecord(entry.properties), "missing event properties");
					events.push({
						event: entry.event,
						distinct_id: entry.distinct_id,
						properties: entry.properties,
					});
				}
			} catch (error) {
				errors.push(error);
			}
			return Response.json({ status: "ok" });
		},
	});
	return {
		origin: `http://127.0.0.1:${server.port}`,
		events,
		errors,
		get requests() {
			return requests;
		},
		stop: () => server.stop(true),
	};
}

export function analyticsProbeEnvironment(
	root: string,
	collectorOrigin: string,
	overrides: Record<string, string> = {},
	inherited: Record<string, string | undefined> = process.env,
): Record<string, string> {
	const endpoint = new URL(collectorOrigin);
	assert(
		endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1" && endpoint.port !== "",
		"analytics probes require a loopback collector",
	);
	return hostEnvironment(
		{
			...overrides,
			HOME: join(root, "home"),
			USERPROFILE: join(root, "home"),
			LOCALAPPDATA: join(root, "local"),
			APPDATA: join(root, "roaming"),
			XDG_CONFIG_HOME: join(root, "config"),
			XDG_DATA_HOME: join(root, "xdg-data"),
			XDG_CACHE_HOME: join(root, "cache"),
			CLAUDE_CONFIG_DIR: join(root, "home", ".claude"),
			CODEX_HOME: join(root, "home", ".codex"),
			GEMINI_CLI_HOME: join(root, "home"),
			THINKRAIL_DATA_DIR: join(root, "data"),
			PI_CODING_AGENT_DIR: join(root, "agent"),
			PI_OFFLINE: "1",
			THINKRAIL_POSTHOG_HOST: endpoint.origin,
			NO_PROXY: "127.0.0.1,localhost",
		},
		["CI", "NODE_ENV", "THINKRAIL_NO_ANALYTICS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"],
		inherited,
	);
}

export function assertDesktopLaunch(
	events: CollectedEvent[],
	expected: { app_version: string; channel: string; os: string; arch: string },
): string {
	assert(
		events.length === 1 && events[0]?.event === "app_started",
		`expected only app_started before consent (no app_installed/additional events), got ${events.map((entry) => entry.event).join(", ")}`,
	);
	const event = events[0];
	assert(
		/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(event.distinct_id),
		"invalid installation UUID",
	);
	for (const [key, value] of Object.entries({ ...expected, build: "desktop" })) {
		assert(event.properties[key] === value, `unexpected ${key}: ${event.properties[key]}`);
	}
	const plainKeys = Object.keys(event.properties)
		.filter((key) => !key.startsWith("$"))
		.sort();
	assert(
		plainKeys.join(",") === "app_version,arch,build,channel,os",
		`unexpected app_started properties: ${plainKeys.join(",")}`,
	);
	assert(
		event.properties.$process_person_profile === false,
		"person profile processing must be off",
	);
	assert(event.properties.$geoip_disable === true, "GeoIP enrichment must be off");
	return event.distinct_id;
}

export async function runDesktopAnalyticsProbe(adapter: ArtifactHostAdapter): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-desktop-analytics-"));
	const collector = startAnalyticsCollector();
	let host: RunningArtifactHost | undefined;
	try {
		const expected = {
			app_version: version,
			channel,
			os:
				process.platform === "darwin"
					? "macos"
					: process.platform === "win32"
						? "windows"
						: process.platform,
			arch: process.arch,
		};
		const scenarios = [
			{ label: "human-first-launch", overrides: {}, muted: false },
			{
				label: "human-restart-additional-opt-out",
				overrides: { THINKRAIL_NO_ANALYTICS: "1" },
				muted: false,
			},
			{ label: "ci-muted", overrides: { CI: "1" }, muted: true },
			{ label: "test-muted", overrides: { NODE_ENV: "test" }, muted: true },
		] satisfies { label: string; overrides: Record<string, string>; muted: boolean }[];
		let installationId: string | undefined;
		for (const scenario of scenarios) {
			const isolated = join(root, scenario.muted ? scenario.label : "human");
			mkdirSync(join(isolated, "home"), { recursive: true });
			const previousEvents = collector.events.length;
			const previousRequests = collector.requests;
			host = await adapter.launch(
				analyticsProbeEnvironment(isolated, collector.origin, scenario.overrides),
				scenario.label,
			);
			const health = await fetch(`${host.origin}/health`, { signal: AbortSignal.timeout(10_000) });
			assert(health.ok && (await health.text()) === "ok", `${scenario.label} host is not healthy`);
			await host.stop();
			host = undefined;
			assert(
				collector.errors.length === 0,
				`invalid collector requests: ${collector.errors.join("; ")}`,
			);
			if (scenario.muted) {
				assert(
					collector.requests === previousRequests,
					`${scenario.label} made analytics requests`,
				);
			} else {
				const id = assertDesktopLaunch(collector.events.slice(previousEvents), expected);
				if (installationId)
					assert(id === installationId, "installation UUID changed across restarts");
				installationId = id;
			}
			console.log(`analytics OK: ${scenario.label}`);
		}
	} finally {
		try {
			await host?.stop();
		} finally {
			await collector.stop();
			removeTree(root);
		}
	}
}
