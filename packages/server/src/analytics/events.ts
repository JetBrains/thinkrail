import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

export type BuildKind = "source" | "binary";

export type LoginMethod = "oauth" | "api-key" | "central";

export type SendMode = "prompt" | "steer" | "follow_up";

export type AnalyticsEvent =
	| { name: "app_installed" }
	| { name: "app_started" }
	| { name: "chat_started"; params: { provider: string; model: string } }
	| { name: "message_sent"; params: { mode: SendMode } }
	| { name: "provider_login"; params: { provider: string; method: LoginMethod } };

export const CUSTOM_BUCKET = "custom";

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

export function bucketProvider(provider: string): string {
	return builtinCatalog().has(provider) ? provider : CUSTOM_BUCKET;
}

export function bucketProviderModel(
	provider: string,
	modelId: string,
): { provider: string; model: string } {
	const models = builtinCatalog().get(provider);
	if (!models) return { provider: CUSTOM_BUCKET, model: CUSTOM_BUCKET };
	return { provider, model: models.has(modelId) ? modelId : CUSTOM_BUCKET };
}
