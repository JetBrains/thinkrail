// `auth.status` — everything the gate + Settings→Providers need in one read: the OAuth flows (with
// featured flags), the API-key catalog (every model provider that can take a key), per-provider auth
// status (never values), the jbcentral probe, and the model count that drives the gate.

import { join } from "node:path";
import type { AuthProviderStatus, AuthStatusResult, JbcentralStatus } from "@thinkrail/contracts";
import {
	isJbcentralWired,
	type ModelsConfig,
	readJsonConfig,
	resolveAgentDir,
	resolveJbcentralBin,
} from "@thinkrail/shared/jbcentral";
import { getPiRuntime } from "../agent";
import { FEATURED_OAUTH_IDS, OAUTH_ONLY_PROVIDER_IDS, PROVIDER_ENV_VARS } from "./catalog";

/** The jbcentral probe: binary presence + whether models.json is currently proxy-wired. Fast + pure-ish
 * (one `which` + one JSON read); it never spawns `jbcentral` itself — login state is discovered by the
 * wizard's own steps, not polled here. */
export async function probeJbcentral(): Promise<JbcentralStatus> {
	const installed = resolveJbcentralBin() !== null;
	let wired = false;
	try {
		const modelsJson = join(resolveAgentDir(process.env), "models.json");
		wired = isJbcentralWired(await readJsonConfig<ModelsConfig>(modelsJson, {}));
	} catch {
		// Unparsable models.json → report unwired; the wire step rewrites it anyway.
	}
	return { installed, wired };
}

/** Build the `auth.status` read. */
export async function buildAuthStatus(): Promise<AuthStatusResult> {
	const { authStorage, modelRegistry } = getPiRuntime();
	const providers: AuthProviderStatus[] = [];

	// OAuth flows (subscription sign-ins). `getProviderAuthStatus` never exposes credential values.
	for (const oauth of authStorage.getOAuthProviders()) {
		const status = modelRegistry.getProviderAuthStatus(oauth.id);
		providers.push({
			id: oauth.id,
			name: oauth.name,
			kind: "oauth",
			...(FEATURED_OAUTH_IDS.includes(oauth.id as (typeof FEATURED_OAUTH_IDS)[number])
				? { featured: true }
				: {}),
			authenticated: status.configured,
			...(status.source ? { source: status.source } : {}),
			...(status.label ? { label: status.label } : {}),
		});
	}

	// API-key catalog: every provider the registry knows models for, minus the OAuth-only ones.
	// (anthropic/openai appear here too — a subscription and a raw key are both valid ways in.)
	const providerIds = new Set<string>();
	for (const model of modelRegistry.getAll()) providerIds.add(model.provider);
	for (const id of [...providerIds].sort()) {
		if (OAUTH_ONLY_PROVIDER_IDS.has(id)) continue;
		const status = modelRegistry.getProviderAuthStatus(id);
		providers.push({
			id,
			name: modelRegistry.getProviderDisplayName(id),
			kind: "api_key",
			authenticated: status.configured,
			...(status.source ? { source: status.source } : {}),
			...(status.label ? { label: status.label } : {}),
			...(PROVIDER_ENV_VARS[id] ? { envVar: PROVIDER_ENV_VARS[id] } : {}),
		});
	}

	return {
		providers,
		jbcentral: await probeJbcentral(),
		modelCount: modelRegistry.getAvailable().length,
	};
}
