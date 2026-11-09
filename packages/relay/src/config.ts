import type { TurnConfig } from "./turnCredentials";

export interface RelayLimits {
	maxConnectionsPerAddress: number;
	messagesPerSecond: number;
	messageBurst: number;
	/** How long a connection may stay unregistered (neither host nor device) before it is closed. */
	pendingTimeoutMs: number;
	maxPayloadBytes: number;
	maxSessionsPerHost: number;
}

export interface RelayConfig {
	port: number;
	host: string;
	/** Read the client address from `X-Forwarded-For`; only behind a reverse proxy that sets it. */
	trustProxy: boolean;
	limits: RelayLimits;
	turn: TurnConfig | null;
}

export const DEFAULT_LIMITS: RelayLimits = {
	maxConnectionsPerAddress: 64,
	messagesPerSecond: 50,
	messageBurst: 200,
	pendingTimeoutMs: 15_000,
	maxPayloadBytes: 512 * 1024,
	maxSessionsPerHost: 64,
};

function positiveInt(value: string | undefined, fallback: number, name: string): number {
	if (value === undefined || value === "") return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0)
		throw new Error(`${name} must be a positive integer`);
	return parsed;
}

/** The relay's whole configuration from its environment; throws on a malformed value instead of guessing. */
export function configFromEnv(env: Record<string, string | undefined>): RelayConfig {
	const turnUrls = (env.TURN_URLS ?? "")
		.split(",")
		.map((url) => url.trim())
		.filter((url) => url.length > 0);
	const turnSecret = env.TURN_SECRET ?? "";
	if (turnUrls.length > 0 && turnSecret === "") throw new Error("TURN_URLS needs TURN_SECRET");
	return {
		port: positiveInt(env.PORT, 24243, "PORT"),
		host: env.HOST || "0.0.0.0",
		trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
		limits: {
			maxConnectionsPerAddress: positiveInt(
				env.MAX_CONNECTIONS_PER_ADDRESS,
				DEFAULT_LIMITS.maxConnectionsPerAddress,
				"MAX_CONNECTIONS_PER_ADDRESS",
			),
			messagesPerSecond: positiveInt(
				env.MESSAGES_PER_SECOND,
				DEFAULT_LIMITS.messagesPerSecond,
				"MESSAGES_PER_SECOND",
			),
			messageBurst: positiveInt(env.MESSAGE_BURST, DEFAULT_LIMITS.messageBurst, "MESSAGE_BURST"),
			pendingTimeoutMs: DEFAULT_LIMITS.pendingTimeoutMs,
			maxPayloadBytes: DEFAULT_LIMITS.maxPayloadBytes,
			maxSessionsPerHost: positiveInt(
				env.MAX_SESSIONS_PER_HOST,
				DEFAULT_LIMITS.maxSessionsPerHost,
				"MAX_SESSIONS_PER_HOST",
			),
		},
		turn:
			turnUrls.length > 0
				? {
						urls: turnUrls,
						secret: turnSecret,
						ttlSeconds: positiveInt(env.TURN_TTL_SECONDS, 12 * 3600, "TURN_TTL_SECONDS"),
					}
				: null,
	};
}
