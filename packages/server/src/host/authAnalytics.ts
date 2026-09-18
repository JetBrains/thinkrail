import type { WireModel } from "@thinkrail/contracts";
import { getSessionRuntimeGeneration, liveParentContext, type PiRuntimeGeneration } from "../agent";
import {
	type AnalyticsAuthMethod,
	bucketProvider,
	bucketProviderModel,
	type LoginMethod,
	type ProviderAnalyticsProperties,
	track,
} from "../analytics";

type AuthRuntime = Pick<
	PiRuntimeGeneration["runtime"],
	| "getProviderAuthStatus"
	| "getProvider"
	| "getRegisteredProviderIds"
	| "isUsingOAuth"
	| "isUsingSubscription"
>;

export interface AuthMetadataContext {
	readonly runtime: AuthRuntime;
	readonly opaqueProviderIds: ReadonlySet<string>;
}

function isUnmodifiedBuiltin(providerId: string, runtime: AuthRuntime): boolean {
	return (
		bucketProvider(providerId) !== "custom" &&
		!runtime.getRegisteredProviderIds().includes(providerId)
	);
}

function hasKnownKeyPath(providerId: string, runtime: AuthRuntime): boolean {
	return (
		isUnmodifiedBuiltin(providerId, runtime) &&
		providerId !== "amazon-bedrock" &&
		providerId !== "google-vertex" &&
		Boolean(runtime.getProvider(providerId)?.auth.apiKey)
	);
}

export function observedAuthMethod(
	providerId: string,
	context: AuthMetadataContext | undefined,
): AnalyticsAuthMethod {
	if (!context) return "unknown";
	try {
		if (context.opaqueProviderIds.has(providerId)) return "central";
		const { runtime } = context;
		const status = runtime.getProviderAuthStatus(providerId);
		if (!status.configured) return "unknown";
		if (
			status.source === "runtime" ||
			status.source === "models_json_key" ||
			status.source === "models_json_command" ||
			status.source === "fallback"
		)
			return "api_key";
		if (runtime.isUsingSubscription(providerId)) return "subscription";
		if (runtime.isUsingOAuth(providerId)) return "oauth";
		if (status.source === "environment" && isUnmodifiedBuiltin(providerId, runtime)) {
			if (providerId === "anthropic")
				return status.label === "ANTHROPIC_API_KEY" ? "api_key" : "other";
			if (providerId === "google-vertex")
				return status.label === "GOOGLE_CLOUD_API_KEY" ? "api_key" : "other";
			if (providerId === "amazon-bedrock")
				return status.label === "AWS_BEARER_TOKEN_BEDROCK" ? "api_key" : "other";
		}
		if (status.source === "stored" || status.source === "environment") {
			return hasKnownKeyPath(providerId, runtime) ? "api_key" : "other";
		}
		return "unknown";
	} catch {
		return "unknown";
	}
}

export function loginAuthMethod(
	providerId: string,
	method: LoginMethod,
	context: AuthMetadataContext | undefined,
): AnalyticsAuthMethod {
	if (method === "central") return "central";
	if (!context) return "unknown";
	try {
		if (context.opaqueProviderIds.has(providerId)) return "central";
		if (method === "oauth") {
			const oauth = context.runtime.getProvider(providerId)?.auth.oauth;
			if (!oauth) return "unknown";
			return oauth.isSubscription === true ? "subscription" : "oauth";
		}
		return hasKnownKeyPath(providerId, context.runtime) ? "api_key" : "other";
	} catch {
		return "unknown";
	}
}

export function sessionProviderAnalytics(
	sessionId: string,
	model?: Pick<WireModel, "provider" | "id">,
): ProviderAnalyticsProperties & { model: string } {
	try {
		const selected = model ?? liveParentContext(sessionId)?.model;
		const bucket = bucketProviderModel(selected?.provider ?? "", selected?.id ?? "");
		return {
			provider: bucket.provider,
			model: bucket.model,
			auth_method: selected
				? observedAuthMethod(selected.provider, getSessionRuntimeGeneration(sessionId))
				: "unknown",
		};
	} catch {
		return { provider: "custom", model: "custom", auth_method: "unknown" };
	}
}

export function trackChatStarted(created: {
	sessionId: string;
	model: Pick<WireModel, "provider" | "id"> | null;
}): void {
	if (created.model) {
		track({
			name: "chat_started",
			params: sessionProviderAnalytics(created.sessionId, created.model),
		});
	}
}
