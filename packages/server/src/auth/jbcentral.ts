// In-app "Connect JetBrains AI" — the server side of wiring pi's Claude+GPT picks through the local
// jbcentral proxy. The jbcentral protocol (probe the secret, override models.json, undo it) lives in
// `@thinkrail/shared/jbcentral`; here we compose it and add the one live-runtime step the standalone CLI
// can't: **reload the shared runtime's models.json** so `provider.status` (and any live session) sees the change.

import type { JbcentralConnectResult } from "@thinkrail/contracts";
import {
	isJbcentralInstalled,
	launchJbcentralLogin,
	unwireJbcentral,
	wireJbcentral,
} from "@thinkrail/shared/jbcentral";
import { getPiRuntime } from "../agent";

/** Whether the `central` CLI is on the host's PATH (cheap, side-effect-free). */
export function jbcentralInstalled(): boolean {
	return isJbcentralInstalled();
}

/**
 * Wire Claude+GPT through the jbcentral proxy (writes models.json), then reload the runtime's config so
 * it takes effect at once. Returns the outcome so the card can walk the user forward (install → sign in → connect).
 */
export async function connectJbcentral(): Promise<JbcentralConnectResult> {
	const result = await wireJbcentral(process.env);
	switch (result.outcome) {
		case "connected":
			await (await getPiRuntime()).reloadConfig();
			return { outcome: "connected" };
		case "needs-install":
			return { outcome: "needs-install" };
		case "needs-login":
			return { outcome: "needs-login" };
		default:
			return { outcome: "error", message: result.message };
	}
}

/** Undo the jbcentral overrides (models.json) and reload the config so the built-in endpoints return. */
export async function disconnectJbcentral(): Promise<void> {
	await unwireJbcentral(process.env);
	await (await getPiRuntime()).reloadConfig();
}

/** Best-effort launch of `central login` (its browser sign-in) on the host. */
export function jbcentralLogin(): { launched: boolean } {
	return { launched: launchJbcentralLogin().launched };
}
