import { createHmac } from "node:crypto";
import type { IceServer } from "@thinkrail/contracts";
import { createKeyedRateLimiter } from "./limits";

export interface TurnConfig {
	urls: string[];
	/** The `static-auth-secret` shared with coturn (`use-auth-secret`). */
	secret: string;
	ttlSeconds: number;
	/** Credentials one client address may be handed per minute (also the burst). */
	issuesPerMinute: number;
}

export function turnCredentials(config: TurnConfig, now: number = Date.now()): IceServer {
	const username = `${Math.floor(now / 1000) + config.ttlSeconds}:thinkrail`;
	const credential = createHmac("sha1", config.secret).update(username).digest("base64");
	return { urls: [...config.urls], username, credential };
}

/** The broker's `iceFor`: fresh credentials per connecting device, none past its address's rate. */
export function turnIssuer(
	config: TurnConfig,
): (address: string, now?: number) => IceServer[] | undefined {
	const rate = createKeyedRateLimiter(config.issuesPerMinute / 60, config.issuesPerMinute);
	return (address, now = Date.now()) =>
		rate.take(address, now) ? [turnCredentials(config, now)] : undefined;
}
