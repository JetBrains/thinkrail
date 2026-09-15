import { logger } from "../log";
import { ensureInstallation } from "../persistence";
import type {
	AdditionalAnalyticsCapture,
	AnalyticsEvent,
	BasicAnalyticsEvent,
	BuildKind,
} from "./events";
import { type AnalyticsEnv, environmentMute } from "./mute";
import {
	type AnalyticsSink,
	createPostHogSink,
	type OutgoingEvent,
	POSTHOG_PROJECT_KEY,
} from "./sink";

const log = logger("analytics");

export interface AnalyticsOptions {
	appVersion?: string;
	channel?: string;
	build?: BuildKind;
	posthogApiKey?: string;
	posthogHost?: string;
	mute?: boolean;
	additionalEnabled: boolean;
	env?: AnalyticsEnv;
	fetchImpl?: typeof fetch;
}

interface AnalyticsGrant {
	sink: AnalyticsSink;
	capture: AdditionalAnalyticsCapture;
}

interface AnalyticsState {
	basic: AnalyticsSink;
	additional: AnalyticsGrant | null;
	createAdditionalSink: (() => AnalyticsSink) | null;
	clientId: string;
	drains: Set<Promise<void>>;
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
	resetAnalyticsForTests();
	try {
		const env = options.env ?? process.env;
		if (environmentMute(env)) return;
		const record = ensureInstallation();
		const host = env.THINKRAIL_POSTHOG_HOST ?? options.posthogHost;
		const createSink = () =>
			createPostHogSink({
				apiKey: options.posthogApiKey ?? POSTHOG_PROJECT_KEY,
				...(host ? { host } : {}),
				...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
			});
		state = {
			basic: createSink(),
			additional: null,
			createAdditionalSink: options.mute || env.THINKRAIL_NO_ANALYTICS ? null : createSink,
			clientId: record.id,
			drains: new Set(),
			env: {
				app_version: options.appVersion ?? "0.0.0-dev",
				channel: options.channel ?? "dev",
				os: detectOs(),
				arch: process.arch,
				build: options.build ?? "source",
			},
		};
		track({ name: "app_started" });
		setAdditionalAnalyticsEnabled(options.additionalEnabled);
	} catch {
		log.debug("analytics initialization failed");
	}
}

export function track(event: BasicAnalyticsEvent): void {
	const s = state;
	if (s && !s.shutdownPromise) send(s, s.basic, event);
}

export function getAdditionalAnalyticsCapture(): AdditionalAnalyticsCapture | null {
	return state?.shutdownPromise ? null : (state?.additional?.capture ?? null);
}

export function setAdditionalAnalyticsEnabled(enabled: boolean): void {
	const s = state;
	if (!s) return;
	try {
		if (!enabled) {
			const grant = s.additional;
			s.additional = null;
			if (grant) retire(s, grant.sink);
		} else if (!s.shutdownPromise && !s.additional && s.createAdditionalSink) {
			const sink = s.createAdditionalSink();
			const capture: AdditionalAnalyticsCapture = (event) => {
				if (state === s && s.additional?.capture === capture && !s.shutdownPromise) {
					send(s, sink, event);
				}
			};
			s.additional = { sink, capture };
		}
	} catch {
		log.debug("analytics preference update failed");
	}
}

export function shutdownAnalytics(): Promise<void> {
	const s = state;
	if (!s) return Promise.resolve();
	s.shutdownPromise ??= Promise.all([
		...s.drains,
		drain(s.basic),
		...(s.additional ? [drain(s.additional.sink)] : []),
	]).then(() => {});
	return s.shutdownPromise;
}

export function resetAnalyticsForTests(): void {
	const s = state;
	state = null;
	if (!s) return;
	retire(s, s.basic);
	if (s.additional) retire(s, s.additional.sink);
}

function retire(s: AnalyticsState, sink: AnalyticsSink): void {
	sink.setSending(false);
	if (s.shutdownPromise) return;
	const pending = drain(sink);
	s.drains.add(pending);
	void pending.then(() => s.drains.delete(pending));
}

async function drain(sink: AnalyticsSink): Promise<void> {
	try {
		await sink.shutdown();
	} catch {
		log.debug("analytics shutdown failed");
	}
}

function send(s: AnalyticsState, sink: AnalyticsSink, event: AnalyticsEvent): void {
	try {
		const outgoing: OutgoingEvent = {
			name: event.name,
			params: { ...s.env, ...("params" in event ? event.params : {}) },
		};
		sink.send(s.clientId, [outgoing]);
	} catch {
		log.debug("analytics capture failed");
	}
}
