// The delivery backend, hidden behind `AnalyticsSink` — swapping vendors is implementing a new sink,
// nothing else in the module (or the host) moves (proven once: the first sink was GA4's Measurement
// Protocol, replaced by PostHog before ever shipping). The current sink is PostHog's capture API: a
// plain fire-and-forget `fetch` POST, no dependencies, no retries, errors swallowed (debug-logged on
// demand). Every outgoing event is personless and GeoIP-free — see `createPostHogSink`.

/** One event as the service hands it to a sink: a name + the allowlist-filtered params. */
export interface OutgoingEvent {
	name: string;
	params: Record<string, string | number>;
}

export interface AnalyticsSink {
	/** Fire-and-forget delivery. Must never throw and never return a promise the caller must await. */
	send(clientId: string, events: OutgoingEvent[]): void;
}

/** The disabled/dev sink: events vanish. */
export const noopSink: AnalyticsSink = {
	send() {
		// deliberately empty — analytics is off or unconfigured
	},
};

export interface PostHogSinkOptions {
	/** The PostHog project API key (`phc_…`) — public by design, like any client-side analytics key. */
	apiKey: string;
	/** Instance origin; defaults to EU cloud. The future self-host seam. */
	host?: string;
	/** Test seam — capture the POST instead of hitting the network. */
	fetchImpl?: typeof fetch;
}

export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

/**
 * The PostHog capture sink (`POST {host}/batch/`). `distinct_id` is the anonymous per-install id.
 * Every event carries `$process_person_profile: false` (personless — PostHog builds no person
 * profiles; unique users still count by distinct_id) and `$geoip_disable: true` (no IP-derived
 * fields, enforced sender-side — the module's privacy contract, not just a project setting).
 */
export function createPostHogSink(options: PostHogSinkOptions): AnalyticsSink {
	const fetchFn = options.fetchImpl ?? fetch;
	const url = `${(options.host ?? POSTHOG_EU_HOST).replace(/\/+$/, "")}/batch/`;
	return {
		send(clientId, events) {
			try {
				fetchFn(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						api_key: options.apiKey,
						batch: events.map((event) => ({
							event: event.name,
							distinct_id: clientId,
							properties: {
								...event.params,
								$process_person_profile: false,
								$geoip_disable: true,
							},
						})),
					}),
				}).catch((error) => debugLog(error));
			} catch (error) {
				debugLog(error);
			}
		},
	};
}

/** Analytics failures are silent by design (never a user-facing warn); opt into logs via env. */
function debugLog(error: unknown): void {
	if (process.env.THINKRAIL_ANALYTICS_DEBUG) {
		console.warn(`analytics send failed: ${error instanceof Error ? error.message : error}`);
	}
}
