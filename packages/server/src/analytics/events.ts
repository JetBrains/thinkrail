// The closed analytics event model — the privacy contract's data half (see SPEC.md). Every event a
// host can emit is a member of `AnalyticsEvent`, and the unit tests pin the exact outgoing payload of
// every variant — a content-leaking field fails CI. (No runtime allowlist filter: the union is closed
// and we control every call site.)
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

/** How the running code was produced: straight from the repo, or a compiled single-file binary. */
export type BuildKind = "source" | "binary";

/** How a provider credential was configured in-app. A closed vocabulary, never user input. */
export type LoginMethod = "oauth" | "api-key" | "central";

/** How a user-authored message was sent. A closed vocabulary mirroring pi's three send methods. */
export type SendMode = "prompt" | "steer" | "follow_up";

/**
 * Every analytics event the host can emit. `app_installed`/`app_started` carry no event params (the
 * env set below rides on every event); the identity params on `chat_started`/`provider_login` pass
 * through `bucketProviderModel`/`bucketProvider` first, so a user-configured name never leaves the
 * process. `message_sent` carries only its closed-vocabulary `mode` — nothing about the message itself.
 */
export type AnalyticsEvent =
	| { name: "app_installed" }
	| { name: "app_started" }
	| { name: "chat_started"; params: { provider: string; model: string } }
	| { name: "message_sent"; params: { mode: SendMode } }
	| { name: "provider_login"; params: { provider: string; method: LoginMethod } };

/** The bucket a user-configured (non-built-in) provider or model id collapses to. */
export const CUSTOM_BUCKET = "custom";

// pi's built-in catalog (provider → model ids), built lazily once — the closed vocabulary identity
// params are checked against. Derived from the pinned pi-ai version, so it never drifts on pi bumps.
let catalog: Map<string, ReadonlySet<string>> | null = null;

function builtinCatalog(): Map<string, ReadonlySet<string>> {
	if (!catalog) {
		catalog = new Map();
		for (const provider of getBuiltinProviders()) {
			catalog.set(provider, new Set(getBuiltinModels(provider).map((model) => String(model.id))));
		}
	}
	return catalog;
}

/** A provider id passes raw only when it is a pi built-in; anything user-configured is `custom`. */
export function bucketProvider(provider: string): string {
	return builtinCatalog().has(provider) ? provider : CUSTOM_BUCKET;
}

/**
 * Identity for `chat_started`: the provider must be a pi built-in AND the model id must be in that
 * provider's built-in catalog — a custom model id on a known provider (free text from models.json)
 * buckets to `custom` too. Fails closed: unknown means `custom`, never a pass-through.
 */
export function bucketProviderModel(
	provider: string,
	modelId: string,
): { provider: string; model: string } {
	const models = builtinCatalog().get(provider);
	if (!models) return { provider: CUSTOM_BUCKET, model: CUSTOM_BUCKET };
	return { provider, model: models.has(modelId) ? modelId : CUSTOM_BUCKET };
}
