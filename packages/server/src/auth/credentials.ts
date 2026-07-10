// API-key writes + provider sign-out. The ONLY place a credential value crosses the wire is the
// `auth.setApiKey` param (client→host, once); it's persisted straight into pi's auth.json and never
// read back out — every read side reports status only.

import type { AuthStatusResult } from "@thinkrail/contracts";
import { getPiRuntime } from "../agent";
import { refreshAuthAndModels } from "./refresh";
import { buildAuthStatus } from "./status";

/** Store an API key for a provider (pi's auth.json), refresh, and return the fresh status. */
export async function setApiKey(providerId: string, key: string): Promise<AuthStatusResult> {
	const trimmed = key.trim();
	if (!providerId) throw new Error("Missing providerId");
	if (trimmed === "") throw new Error("API key is empty");
	getPiRuntime().authStorage.set(providerId, { type: "api_key", key: trimmed });
	refreshAuthAndModels();
	return buildAuthStatus();
}

/** Remove a provider's stored credential (key or OAuth tokens), refresh, and return fresh status. */
export async function logoutProvider(providerId: string): Promise<AuthStatusResult> {
	if (!providerId) throw new Error("Missing providerId");
	getPiRuntime().authStorage.logout(providerId);
	refreshAuthAndModels();
	return buildAuthStatus();
}
