import { PostHog } from "posthog-node";
import { logger } from "../log";

const log = logger("analytics");

export interface OutgoingEvent {
	name: string;
	params: Record<string, string | number>;
}

export interface AnalyticsSink {
	send(clientId: string, events: OutgoingEvent[]): void;
	setSending?(enabled: boolean): void;
	shutdown?(): Promise<void>;
}

export const noopSink: AnalyticsSink = {
	send() {},
};

export interface PostHogSinkOptions {
	apiKey: string;
	host?: string;
	fetchImpl?: typeof fetch;
}

export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

export const POSTHOG_PROJECT_KEY = "phc_AFJBcKraEUrfpTrSSMjBGXMHTusYudtFfxWqdevchy8X";

const SHUTDOWN_TIMEOUT_MS = 2_000;

export function createPostHogSink(options: PostHogSinkOptions): AnalyticsSink {
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

function debugLog(_error: unknown): void {
	log.debug("analytics send failed");
}
