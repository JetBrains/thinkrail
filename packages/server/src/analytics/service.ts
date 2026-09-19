import { logger } from "../log";
import {
	type AcquisitionRecord,
	ATTRIBUTION_LIFETIME_MS,
	claimAppInstalled,
	claimBrowserAttributionAttempt,
	ensureInstallation,
	readAcquisition,
	replaceAcquisitionWithTerminalMarker,
	saveAcquisition,
} from "../persistence";
import { runAttributionClaim } from "./attribution";
import {
	type AdditionalAnalyticsCapture,
	type AnalyticsEvent,
	acquisitionCampaignProperties,
	type BasicAnalyticsEvent,
	type BuildKind,
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
	openExternal?: (url: string) => void | Promise<void>;
	attributionEndpoint?: string;
	attributionFetch?: typeof fetch;
	attributionSleep?: (milliseconds: number) => Promise<void>;
	attributionSchedule?: (run: () => void) => void;
	attributionRequestTimeoutMs?: number;
	attributionDeadlineMs?: number;
	attributionPersist?: typeof saveAcquisition;
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
	acquisition: AcquisitionRecord | null;
	attributionGeneration: number;
	attributionAbort: AbortController;
	attribution: Pick<
		AnalyticsOptions,
		| "openExternal"
		| "attributionEndpoint"
		| "attributionFetch"
		| "attributionSleep"
		| "attributionSchedule"
		| "attributionRequestTimeoutMs"
		| "attributionDeadlineMs"
		| "attributionPersist"
	>;
	env: { app_version: string; channel: string; os: string; arch: string; build: BuildKind };
}

let state: AnalyticsState | null = null;

function detectOs(): string {
	if (process.platform === "darwin") return "macos";
	if (process.platform === "win32") return "windows";
	return process.platform;
}

export function initializeAnalytics(options: AnalyticsOptions): void {
	initializeAnalyticsWithSinkFactoryForTests(options, createPostHogSink);
}

export function initializeAnalyticsWithSinkFactoryForTests(
	options: AnalyticsOptions,
	sinkFactory: typeof createPostHogSink,
): void {
	resetAnalyticsForTests();
	try {
		const env = options.env ?? process.env;
		if (environmentMute(env)) return;
		// Reading on every eligible startup also terminalizes malformed or expired persisted context.
		readAcquisition();
		const host = env.THINKRAIL_POSTHOG_HOST ?? options.posthogHost;
		const createSink = () =>
			sinkFactory({
				apiKey: options.posthogApiKey ?? POSTHOG_PROJECT_KEY,
				...(host ? { host } : {}),
				...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
			});
		const basic = createSink();
		const record = ensureInstallation();
		const build = options.build ?? "source";
		const appInstalled = build !== "source" && claimAppInstalled();
		state = {
			basic,
			additional: null,
			createAdditionalSink: options.mute || env.THINKRAIL_NO_ANALYTICS ? null : createSink,
			clientId: record.id,
			drains: new Set(),
			acquisition: null,
			attributionGeneration: 0,
			attributionAbort: new AbortController(),
			attribution: {
				...(options.openExternal ? { openExternal: options.openExternal } : {}),
				...(options.attributionEndpoint
					? { attributionEndpoint: options.attributionEndpoint }
					: {}),
				...(options.attributionFetch ? { attributionFetch: options.attributionFetch } : {}),
				...(options.attributionSleep ? { attributionSleep: options.attributionSleep } : {}),
				...(options.attributionSchedule
					? { attributionSchedule: options.attributionSchedule }
					: {}),
				...(options.attributionRequestTimeoutMs !== undefined
					? { attributionRequestTimeoutMs: options.attributionRequestTimeoutMs }
					: {}),
				...(options.attributionDeadlineMs !== undefined
					? { attributionDeadlineMs: options.attributionDeadlineMs }
					: {}),
				...(options.attributionPersist ? { attributionPersist: options.attributionPersist } : {}),
			},
			env: {
				app_version: options.appVersion ?? "0.0.0-dev",
				channel: options.channel ?? "dev",
				os: detectOs(),
				arch: process.arch,
				build,
			},
		};
		setAdditionalAnalyticsEnabled(options.additionalEnabled);
		if (appInstalled) track({ name: "app_installed" });
		track({ name: "app_started" });
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
			cancelAttributionGeneration(s);
			s.acquisition = null;
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
			s.acquisition = readAcquisition() ?? null;
		}
	} catch {
		log.debug("analytics preference update failed");
	}
}

export function startAttributionClaim(): void {
	const s = state;
	if (
		!s ||
		s.shutdownPromise ||
		!s.additional ||
		s.env.build === "source" ||
		!s.attribution.openExternal
	) {
		return;
	}
	const generation = s.attributionGeneration;
	const generationSignal = s.attributionAbort.signal;
	const schedule = s.attribution.attributionSchedule ?? ((run: () => void) => queueMicrotask(run));
	try {
		schedule(() => {
			if (
				state !== s ||
				s.shutdownPromise ||
				s.attributionGeneration !== generation ||
				!s.additional ||
				!s.attribution.openExternal ||
				generationSignal.aborted
			) {
				return;
			}
			try {
				if (!claimBrowserAttributionAttempt()) return;
			} catch {
				return;
			}
			const active = () =>
				state === s &&
				!s.shutdownPromise &&
				s.attributionGeneration === generation &&
				!generationSignal.aborted &&
				s.additional !== null;
			void runAttributionClaim({
				...(s.attribution.attributionEndpoint
					? { endpoint: s.attribution.attributionEndpoint }
					: {}),
				...(s.attribution.attributionFetch ? { fetchImpl: s.attribution.attributionFetch } : {}),
				...(s.attribution.attributionSleep ? { sleep: s.attribution.attributionSleep } : {}),
				...(s.attribution.attributionRequestTimeoutMs !== undefined
					? { requestTimeoutMs: s.attribution.attributionRequestTimeoutMs }
					: {}),
				...(s.attribution.attributionDeadlineMs !== undefined
					? { overallDeadlineMs: s.attribution.attributionDeadlineMs }
					: {}),
				signal: generationSignal,
				openExternal: s.attribution.openExternal,
				active,
				persist: ({ first_touch, last_touch }) =>
					(s.attribution.attributionPersist ?? saveAcquisition)({ first_touch, last_touch }),
				linked: (redeemed) => {
					if (!active()) return;
					s.acquisition = {
						first_touch: redeemed.first_touch,
						last_touch: redeemed.last_touch,
					};
					s.additional?.capture({
						name: "acquisition_linked",
						params: {
							journey_id: redeemed.journey_id,
							bridge_id: redeemed.bridge_id,
							...acquisitionCampaignProperties(redeemed),
						},
					});
				},
			});
		});
	} catch {
		log.debug("analytics attribution scheduling failed");
	}
}

export function shutdownAnalytics(): Promise<void> {
	const s = state;
	if (!s) return Promise.resolve();
	cancelAttributionGeneration(s);
	s.acquisition = null;
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
	cancelAttributionGeneration(s);
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

function cancelAttributionGeneration(s: AnalyticsState): void {
	s.attributionGeneration++;
	s.attributionAbort.abort();
	s.attributionAbort = new AbortController();
}

function acquisitionForEnrichment(s: AnalyticsState): AcquisitionRecord | null {
	const acquisition = s.acquisition;
	if (!acquisition) return null;
	if (acquisition.last_touch.touched_at >= Date.now() - ATTRIBUTION_LIFETIME_MS) {
		return acquisition;
	}
	s.acquisition = null;
	try {
		replaceAcquisitionWithTerminalMarker();
	} catch {
		log.debug("expired analytics attribution cleanup failed");
	}
	return null;
}

function send(s: AnalyticsState, sink: AnalyticsSink, event: AnalyticsEvent): void {
	try {
		const acquisition =
			event.name !== "app_installed" && event.name !== "acquisition_linked"
				? acquisitionForEnrichment(s)
				: null;
		const campaign = acquisition ? acquisitionCampaignProperties(acquisition) : {};
		const outgoing: OutgoingEvent = {
			name: event.name,
			params: { ...s.env, ...campaign, ...("params" in event ? event.params : {}) },
		};
		sink.send(s.clientId, [outgoing]);
	} catch {
		log.debug("analytics capture failed");
	}
}
