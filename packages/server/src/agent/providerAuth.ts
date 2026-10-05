import type { ProviderAuthKind, WireModelAuth } from "@thinkrail/contracts";
import type { PiRuntimeGeneration } from "./piRuntime";

type AuthSource = NonNullable<
	ReturnType<PiRuntimeGeneration["runtime"]["getProviderAuthStatus"]>["source"]
>;

export interface ProviderAuthFacts {
	central: boolean;
	oauth: boolean;
	/** A stored API-key credential exists; set by callers that already listed credentials. */
	apiKeyCredential?: boolean;
	source?: AuthSource;
	label?: string;
}

export function describeProviderAuth(facts: ProviderAuthFacts): WireModelAuth {
	const kind = resolveKind(facts);
	const detail = resolveDetail(facts);
	return detail === undefined ? { kind } : { kind, detail };
}

function resolveKind(facts: ProviderAuthFacts): ProviderAuthKind {
	if (facts.central) return "central";
	if (facts.oauth) return "oauth";
	if (facts.apiKeyCredential) return "api-key";
	switch (facts.source) {
		case "environment":
			return "env";
		case "stored":
		case "models_json_key":
		case "models_json_command":
		case "runtime":
			return "api-key";
		default:
			return "other";
	}
}

function resolveDetail(facts: ProviderAuthFacts): string | undefined {
	if (facts.central) return undefined;
	if (facts.label) return facts.label;
	if (facts.source === "models_json_key") return "models.json";
	if (facts.source === "models_json_command") return "models.json (command)";
	return undefined;
}

export function catalogProviderAuth(
	generation: Pick<PiRuntimeGeneration, "runtime" | "opaqueProviderIds">,
	providerId: string,
): WireModelAuth {
	const status = generation.runtime.getProviderAuthStatus(providerId);
	return describeProviderAuth({
		central: generation.opaqueProviderIds.has(providerId),
		oauth: generation.runtime.isUsingOAuth(providerId),
		...(status.source === undefined ? {} : { source: status.source }),
		...(status.label === undefined ? {} : { label: status.label }),
	});
}
