// The analytics facade: initialize once at host boot, `track()` from host call sites, sync the config
// flag via `setAnalyticsSending`. Fire-and-forget end to end — nothing here may throw into a caller or
// block boot. The privacy contract (single anonymous id, closed events, release-only sending) is
// SPEC.md's "Get right" section; this file is its runtime half.
import { ensureInstallation, saveInstallation } from "../persistence";
import type { AnalyticsEvent } from "./events";
import { type AnalyticsSink, createPostHogSink, noopSink, type OutgoingEvent } from "./sink";

export interface AnalyticsOptions {
	/** The launcher's baked release version (absent from source — stamped like `appVersion`). */
	appVersion?: string;
	/** Release channel; only `stable` / `nightly` ever send — anything else lands on the noop sink. */
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
	/** Memoized drain — `shutdownAnalytics` is idempotent (boot's awaited call and stop's void call share it). */
	shutdownPromise?: Promise<void>;
	env: { app_version: string; channel: string; os: string; arch: string };
}

let state: AnalyticsState | null = null;

/** The ONLY channels that ever get a real sink — everything else fails closed to noop. */
const SENDING_CHANNELS: ReadonlySet<string> = new Set(["stable", "nightly"]);

function detectOs(): string {
	if (process.platform === "darwin") return "macos";
	if (process.platform === "win32") return "windows";
	return process.platform;
}

/**
 * Boot the analytics service (called once from `createServer`). Mints/loads the installation record,
 * picks the sink — the release-baked key on a `stable`/`nightly` channel; anything else (dev, source,
 * e2e, unknown channels) fails closed to noop, with deliberately **no env-var key override** — and
 * emits the lifecycle events. On the first sending-enabled boot ever it prints the first-run notice
 * and sends the one-shot `app_installed`.
 */
export function initializeAnalytics(options: AnalyticsOptions): void {
	try {
		const record = ensureInstallation();
		const channel = options.channel ?? "dev";
		const host = process.env.THINKRAIL_POSTHOG_HOST ?? options.posthogHost;

		let sink = noopSink;
		const apiKey = SENDING_CHANNELS.has(channel) ? options.posthogApiKey : undefined;
		if (apiKey) {
			sink = createPostHogSink({
				apiKey,
				...(host ? { host } : {}),
				...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
			});
		}

		const realSink = sink !== noopSink;
		const mute = options.mute === true;
		sink.setSending?.(options.enabled && !mute);
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
 * Params are the env stamp + the event's own closed params — the union is closed and the unit tests
 * pin every variant's exact payload, so a content-leaking field fails CI rather than being filtered.
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
 * the settings broadcast. The flip propagates into the sink's transport gate too, so turning off also
 * silences events already queued inside the SDK and retries of a failed send — zero network from this
 * instant. Flipping to enabled runs the pending install announce (notice + one-shot `app_installed`)
 * if this install has never sent one. The id is deliberately NOT rotated on toggles.
 */
export function setAnalyticsSending(enabled: boolean): void {
	const s = state;
	if (!s) return;
	try {
		s.sending = enabled && !s.mute && s.realSink;
		s.sink.setSending?.(s.sending);
		if (s.sending) {
			if (!s.announced) announceInstall(s);
		}
	} catch (error) {
		debugLog(error);
	}
}

/**
 * Drain the sink's queued/in-flight deliveries — bounded inside the sink, idempotent (memoized), and
 * it never throws. `bootHost`'s signal handler AWAITS it before `process.exit`; the sync
 * `server.stop()` fires the same memoized drain without awaiting (best-effort by contract).
 */
export function shutdownAnalytics(): Promise<void> {
	const s = state;
	if (!s?.realSink) return Promise.resolve();
	s.shutdownPromise ??= (async () => {
		try {
			await s.sink.shutdown?.();
		} catch (error) {
			debugLog(error);
		}
	})();
	return s.shutdownPromise;
}

/** Drop the singleton state (draining any real sink, fire-and-forget) — unit-test isolation only. */
export function resetAnalyticsForTests(): void {
	const s = state;
	state = null;
	if (s?.realSink) void s.sink.shutdown?.();
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
	return {
		name: event.name,
		params: { ...s.env, ...("params" in event ? event.params : {}) },
	};
}

function debugLog(error: unknown): void {
	if (process.env.THINKRAIL_ANALYTICS_DEBUG) {
		console.warn(`analytics failed: ${error instanceof Error ? error.message : error}`);
	}
}
