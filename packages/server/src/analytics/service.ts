// The analytics facade: initialize once at host boot, `track()` from host call sites, sync the config
// flag via `setAnalyticsSending`. Fire-and-forget end to end — nothing here may throw into a caller or
// block boot. The privacy contract (single anonymous id, closed events, dev-run silence) is SPEC.md's
// "Get right" section; this file is its runtime half.
import { ensureInstallation, saveInstallation } from "../persistence";
import { type AnalyticsEvent, PARAM_ALLOWLIST } from "./events";
import { type AnalyticsSink, createPostHogSink, noopSink, type OutgoingEvent } from "./sink";

export interface AnalyticsOptions {
	/** The launcher's baked release version (absent from source — stamped like `appVersion`). */
	appVersion?: string;
	/** Release channel (`stable` / `nightly`); defaults to `dev`, which refuses a baked key. */
	channel?: string;
	/** PostHog project API key baked by the release pipeline (empty/absent from source ⇒ noop sink). */
	posthogApiKey?: string;
	/** PostHog instance origin override (defaults to EU cloud) — the self-host seam. */
	posthogHost?: string;
	/** `--no-analytics`: mute this run without touching the persisted flag. */
	mute?: boolean;
	/** The persisted `AppConfig.analyticsEnabled` at boot. */
	enabled: boolean;
	/** Test seam, threaded into the sink. */
	fetchImpl?: typeof fetch;
}

interface AnalyticsState {
	sink: AnalyticsSink;
	/** The anonymous per-install id (PostHog `distinct_id`) — never crosses the wire. */
	clientId: string;
	/** All gates folded: config flag AND not muted AND a real sink. */
	sending: boolean;
	mute: boolean;
	realSink: boolean;
	announced: boolean;
	env: { app_version: string; channel: string; os: string; arch: string };
}

let state: AnalyticsState | null = null;

function detectOs(): string {
	if (process.platform === "darwin") return "macos";
	if (process.platform === "win32") return "windows";
	return process.platform;
}

/**
 * Boot the analytics service (called once from `createServer`). Mints/loads the installation record,
 * picks the sink — an env-override key always wins (deliberate pipeline testing); the baked key is
 * refused on the `dev` channel (dev runs never send); otherwise noop — and emits the lifecycle
 * events. On the first sending-enabled boot ever it prints the first-run notice and sends the
 * one-shot `app_installed`.
 */
export function initializeAnalytics(options: AnalyticsOptions): void {
	try {
		const record = ensureInstallation();
		const channel = options.channel ?? "dev";
		const envApiKey = process.env.THINKRAIL_POSTHOG_API_KEY;
		const host = process.env.THINKRAIL_POSTHOG_HOST ?? options.posthogHost;

		let sink = noopSink;
		const apiKey = envApiKey || (channel !== "dev" ? options.posthogApiKey : undefined);
		if (apiKey) {
			sink = createPostHogSink({
				apiKey,
				...(host ? { host } : {}),
				...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
			});
		}

		const realSink = sink !== noopSink;
		const mute = options.mute === true;
		state = {
			sink,
			clientId: record.id,
			mute,
			realSink,
			sending: options.enabled && !mute && realSink,
			announced: record.announced,
			env: {
				app_version: options.appVersion ?? "0.0.0-dev",
				channel,
				os: detectOs(),
				arch: process.arch,
			},
		};

		if (state.sending) {
			if (!state.announced) announceInstall(state);
			track({ name: "app_started" });
		}
	} catch (error) {
		debugLog(error);
	}
}

/**
 * Emit one event, fire-and-forget. No-ops unless every gate is open; never throws into the caller.
 * Params are stamped (env) and filtered against `PARAM_ALLOWLIST` — an off-list key is
 * dropped here, so a content leak cannot leave the process even if the event model grows a bug.
 */
export function track(event: AnalyticsEvent): void {
	const s = state;
	if (!s?.sending) return;
	try {
		s.sink.send(s.clientId, [toOutgoingEvent(event, s)]);
	} catch (error) {
		debugLog(error);
	}
}

/**
 * Sync the persisted `AppConfig.analyticsEnabled` flag into the live service — the host calls this off
 * the settings broadcast. Flipping to enabled runs the pending install announce (notice + one-shot
 * `app_installed`) if this install has never sent one. The id is deliberately NOT rotated on toggles.
 */
export function setAnalyticsSending(enabled: boolean): void {
	const s = state;
	if (!s) return;
	try {
		s.sending = enabled && !s.mute && s.realSink;
		if (s.sending) {
			if (!s.announced) announceInstall(s);
		}
	} catch (error) {
		debugLog(error);
	}
}

/** Drop the singleton state — unit-test isolation only. */
export function resetAnalyticsForTests(): void {
	state = null;
}

function announceInstall(s: AnalyticsState): void {
	s.announced = true;
	saveInstallation({ id: s.clientId, announced: true });
	console.log(
		"ThinkRail sends anonymous usage analytics (no personal data — see the README's Analytics & Privacy section). Disable in Settings → Privacy, or launch with --no-analytics.",
	);
	track({ name: "app_installed" });
}

function toOutgoingEvent(event: AnalyticsEvent, s: AnalyticsState): OutgoingEvent {
	const params: Record<string, string | number> = { ...s.env };
	if ("params" in event) {
		for (const [key, value] of Object.entries(event.params)) {
			if (PARAM_ALLOWLIST.has(key)) params[key] = value;
		}
	}
	return { name: event.name, params };
}

function debugLog(error: unknown): void {
	if (process.env.THINKRAIL_ANALYTICS_DEBUG) {
		console.warn(`analytics failed: ${error instanceof Error ? error.message : error}`);
	}
}
