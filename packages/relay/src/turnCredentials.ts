import { createHmac } from "node:crypto";
import type { IceServer } from "@thinkrail/contracts";

export interface TurnConfig {
	urls: string[];
	/** The `static-auth-secret` shared with coturn (`use-auth-secret`). */
	secret: string;
	ttlSeconds: number;
}

export function turnCredentials(config: TurnConfig, now: number = Date.now()): IceServer {
	const username = `${Math.floor(now / 1000) + config.ttlSeconds}:thinkrail`;
	const credential = createHmac("sha1", config.secret).update(username).digest("base64");
	return { urls: [...config.urls], username, credential };
}
