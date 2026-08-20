import { ensureInstallation, saveInstallation } from "../persistence";
import type { AnalyticsEvent, BuildKind } from "./events";
import { type AnalyticsEnv, environmentMute } from "./mute";
import {
	type AnalyticsSink,
	createPostHogSink,
	noopSink,
	type OutgoingEvent,
	POSTHOG_PROJECT_KEY,
} from "./sink";

export interface AnalyticsOptions {
	appVersion?: string;
	channel?: string;
	build?: BuildKind;
	posthogApiKey?: string;
	posthogHost?: string;
	mute?: boolean;
	enabled: boolean;
	env?: AnalyticsEnv;
	fetchImpl?: typeof fetch;
}

interface AnalyticsState {
	sink: AnalyticsSink;
	clientId: string;
	sending: boolean;
	realSink: boolean;
	announced: boolean;
	shutdownPromise?: Promise<void>;
	env: { app_version: string; channel: string; os: string; arch: string; build: BuildKind };
}

let state: AnalyticsState | null = null;

function detectOs(): string {
	if (process.platform === "darwin") return "macos";
	if (process.platform === "win32") return "windows";
	return process.platform;
}

export function initializeAnalytics(options: AnalyticsOptions): void {
	try {
		const record = ensureInstallation();
		const env = options.env ?? process.env;
		const host = env.THINKRAIL_POSTHOG_HOST ?? options.posthogHost;
		const muted = options.mute === true || environmentMute(env) !== null;
		const sink: AnalyticsSink = muted
			? noopSink
			: createPostHogSink({
					apiKey: options.posthogApiKey ?? POSTHOG_PROJECT_KEY,
					...(host ? { host } : {}),
					...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
				});

		const realSink = sink !== noopSink;
		sink.setSending?.(options.enabled);
		state = {
			sink,
			clientId: record.id,
			realSink,
			sending: options.enabled && realSink,
			announced: record.announced,
			env: {
				app_version: options.appVersion ?? "0.0.0-dev",
				channel: options.channel ?? "dev",
				os: detectOs(),
				arch: process.arch,
				build: options.build ?? "source",
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

export function track(event: AnalyticsEvent): void {
	const s = state;
	if (!s?.sending) return;
	try {
		s.sink.send(s.clientId, [toOutgoingEvent(event, s)]);
	} catch (error) {
		debugLog(error);
	}
}

export function setAnalyticsSending(enabled: boolean): void {
	const s = state;
	if (!s) return;
	try {
		s.sending = enabled && s.realSink;
		s.sink.setSending?.(s.sending);
		if (s.sending) {
			if (!s.announced) announceInstall(s);
		}
	} catch (error) {
		debugLog(error);
	}
}

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
