// The delivery backend, hidden behind `AnalyticsSink` — swapping vendors is implementing a new sink,
// nothing else in the module (or the host) moves. The first real sink is GA4's Measurement Protocol
// (Firebase Analytics IS GA4; there is no server-side Firebase SDK, MP is the ingestion path): a plain
// fire-and-forget `fetch` POST, no dependencies, no retries, errors swallowed (debug-logged on demand).

/** One event as GA4's `/mp/collect` expects it inside `events[]`. */
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

export interface Ga4SinkOptions {
	measurementId: string;
	apiSecret: string;
	/** Test seam — capture the POST instead of hitting the network. */
	fetchImpl?: typeof fetch;
	/** Test/override seam for the collect endpoint. */
	endpoint?: string;
}

const GA4_ENDPOINT = "https://www.google-analytics.com/mp/collect";

/**
 * The GA4 Measurement Protocol sink. `client_id` is the anonymous per-install id; events must carry
 * `session_id` + `engagement_time_msec` params (the service adds them) or GA4 won't count active users.
 */
export function createGa4Sink(options: Ga4SinkOptions): AnalyticsSink {
	const fetchFn = options.fetchImpl ?? fetch;
	const endpoint = options.endpoint ?? GA4_ENDPOINT;
	const url = `${endpoint}?measurement_id=${encodeURIComponent(options.measurementId)}&api_secret=${encodeURIComponent(options.apiSecret)}`;
	return {
		send(clientId, events) {
			try {
				fetchFn(url, {
					method: "POST",
					body: JSON.stringify({ client_id: clientId, events }),
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
