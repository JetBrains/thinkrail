// The delivery backend, hidden behind `AnalyticsSink` — swapping vendors is implementing a new sink,
// nothing else in the module (or the host) moves (proven twice: GA4's Measurement Protocol → a
// hand-rolled PostHog capture POST → the official `posthog-node` SDK). The SDK is value-imported here
// and nowhere else; its queue/retry machinery stays an implementation detail behind `send`/`shutdown`.
// Errors are swallowed and debug-logged on demand — analytics failures are never user-facing.
import { PostHog } from "posthog-node";

/** One event as the service hands it to a sink: a name + the stamped event params. */
export interface OutgoingEvent {
	name: string;
	params: Record<string, string | number>;
}

export interface AnalyticsSink {
	/** Fire-and-forget delivery. Must never throw and never return a promise the caller must await. */
	send(clientId: string, events: OutgoingEvent[]): void;
	/**
	 * Flip the transport gate. `false` ⇒ zero network from this instant — including events already
	 * queued inside the vendor SDK and retries of an already-failed send (they die at the gate).
	 */
	setSending?(enabled: boolean): void;
	/** Drain queued/in-flight deliveries, bounded — a graceful-stop courtesy, never required. */
	shutdown?(): Promise<void>;
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

/** How long a graceful stop waits for the SDK to drain its queue before giving up. */
const SHUTDOWN_TIMEOUT_MS = 2_000;

/**
 * The PostHog sink: `posthog-node` configured for our shape — `flushAt: 1` (a handful of events per
 * run; dispatch each capture immediately, the SDK still retries failed sends), `disableGeoip: true`
 * (no IP-derived fields, enforced sender-side — the module's privacy contract, not just a project
 * setting), `disableCompression: true` (tiny payloads; keeps the wire inspectable for tests and
 * debugging). `distinct_id` is the anonymous per-install id, and every event is sent **personless**
 * (`$process_person_profile: false` — PostHog builds no person profiles; unique users still count by
 * distinct_id).
 */
export function createPostHogSink(options: PostHogSinkOptions): AnalyticsSink {
	// The transport gate: the SDK only ever talks to the network through THIS fetch, so flipping
	// `sending` silences everything downstream of it — queued flushes and the retry loop of a failed
	// send included. (The SDK's own `disable()` can't do this: it only stops new enqueues — its
	// flush/retry paths never re-check it.) The synthetic 200 reads as success, so retry loops end.
	let sending = true;
	const realFetch = options.fetchImpl ?? fetch;
	const gatedFetch = (url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
		if (!sending) return Promise.resolve(new Response('{"status":"dropped client-side"}'));
		return realFetch(url, init);
	};
	const client = new PostHog(options.apiKey, {
		host: (options.host ?? POSTHOG_EU_HOST).replace(/\/+$/, ""),
		flushAt: 1,
		disableGeoip: true,
		disableCompression: true,
		fetch: gatedFetch,
	});
	client.on("error", (error) => debugLog(error));
	return {
		send(clientId, events) {
			try {
				for (const event of events) {
					client.capture({
						distinctId: clientId,
						event: event.name,
						properties: { ...event.params, $process_person_profile: false },
					});
				}
			} catch (error) {
				debugLog(error);
			}
		},
		setSending(enabled) {
			sending = enabled;
		},
		async shutdown() {
			try {
				await client.shutdown(SHUTDOWN_TIMEOUT_MS);
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
