import { type EventMessage, PostHog } from "posthog-node";
import { logger } from "../log";
import { createExceptionSanitizer } from "./errors";

const log = logger("analytics");

export interface OutgoingEvent {
	name: string;
	params: Record<string, string | number>;
}

export interface AnalyticsSink {
	send(clientId: string, events: OutgoingEvent[]): void;
	sendException(
		clientId: string,
		error: unknown,
		params: Record<string, string | boolean>,
		immediate: boolean,
	): Promise<void>;
	setSending(enabled: boolean): void;
	shutdown(): Promise<void>;
}

export interface PostHogSinkOptions {
	apiKey: string;
	host?: string;
	fetchImpl?: typeof fetch;
	retryDelayMs?: number;
	appRoot?: string;
}

export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

const SHUTDOWN_TIMEOUT_MS = 2_000;

function exceptionBeforeSend(
	appRoot?: string,
): (event: EventMessage | null) => EventMessage | null {
	const sanitize = createExceptionSanitizer(appRoot);
	return (event) => {
		if (event?.event !== "$exception") return event;
		try {
			return { ...event, properties: sanitize(event.properties ?? {}) };
		} catch {
			return null;
		}
	};
}

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
		before_send: exceptionBeforeSend(options.appRoot),
		...(options.retryDelayMs === undefined ? {} : { fetchRetryDelay: options.retryDelayMs }),
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
		async sendException(clientId, error, params, immediate) {
			try {
				const properties = { ...params, $process_person_profile: false };
				if (immediate) await client.captureExceptionImmediate(error, clientId, properties);
				else client.captureException(error, clientId, properties);
			} catch (caught) {
				debugLog(caught);
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
