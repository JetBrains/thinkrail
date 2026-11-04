import { createHmac } from "node:crypto";
import type { IceServer } from "@thinkrail/contracts";

export interface TurnConfig {
	urls: string[];
	/** The `static-auth-secret` shared with coturn (`use-auth-secret`). */
	secret: string;
	ttlSeconds: number;
}

/**
 * Short-lived TURN credentials in coturn's REST-API scheme: the username is the expiry timestamp and the
 * password an HMAC-SHA1 of it under the shared secret, so coturn verifies them with no call back to the relay
 * and a leaked pair stops working on its own.
 */
export function turnCredentials(config: TurnConfig, now: number = Date.now()): IceServer {
	const username = `${Math.floor(now / 1000) + config.ttlSeconds}:thinkrail`;
	const credential = createHmac("sha1", config.secret).update(username).digest("base64");
	return { urls: [...config.urls], username, credential };
}
