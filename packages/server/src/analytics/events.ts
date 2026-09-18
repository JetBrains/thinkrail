import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";

export type BuildKind = "source" | "binary" | "desktop";

export type LoginMethod = "oauth" | "api-key" | "central";
export type AnalyticsAuthMethod =
	| "api_key"
	| "subscription"
	| "oauth"
	| "central"
	| "other"
	| "unknown";

export interface ProviderAnalyticsProperties {
	provider: string;
	auth_method: AnalyticsAuthMethod;
}

export type SendMode = "prompt" | "steer" | "follow_up";

export type BasicAnalyticsEvent =
	| { name: "app_started" }
	| { name: "chat_started"; params: ProviderAnalyticsProperties & { model: string } }
	| { name: "message_sent"; params: ProviderAnalyticsProperties & { mode: SendMode } }
	| { name: "provider_login"; params: ProviderAnalyticsProperties & { method: LoginMethod } };

export type AnalyticsAvailability = "yes" | "no" | "unknown";
export type AnalyticsFailureReason =
	| "auth"
	| "network"
	| "permission"
	| "not_git"
	| "unsupported"
	| "unknown"
	| "none";
export type SetupAction =
	| "provider_connect"
	| "project_open"
	| "project_init"
	| "worktree_create"
	| "worktree_attach";
export type AnalyticsDurationBucket = "<10s" | "10–59s" | "1–4m" | "5–14m" | "15m+" | "unknown";
export type AnalyticsCountBucket = "0" | "1" | "2–4" | "5+" | "unknown";
export type AnalyticsRunOutcome =
	| "normal_stop"
	| "error"
	| "truncated"
	| "aborted"
	| "no_terminal"
	| "other";

export interface AnalyticsRunProperties {
	origin: "user" | "internal" | "mixed" | "unknown";
	workspace_kind: "default" | "managed" | "external";
	provider: string;
	model: string;
}

export type AdditionalAnalyticsEvent =
	| {
			name: "setup_state_observed";
			params: {
				provider_available: AnalyticsAvailability;
				model_available: AnalyticsAvailability;
				project_present: AnalyticsAvailability;
			};
	  }
	| {
			name: "setup_action_finished";
			params: {
				action: SetupAction;
				outcome: "succeeded" | "failed" | "cancelled";
				reason: AnalyticsFailureReason;
			};
	  }
	| { name: "agent_run_started"; params: AnalyticsRunProperties }
	| {
			name: "agent_run_settled";
			params: AnalyticsRunProperties & {
				outcome: AnalyticsRunOutcome;
				duration_bucket: AnalyticsDurationBucket;
				retry_bucket: AnalyticsCountBucket;
				compaction_bucket: AnalyticsCountBucket;
			};
	  }
	| {
			name: "task_completed";
			params: {
				change_evidence: "none" | "commit" | "changes" | "both";
				verification_recorded: "yes" | "no";
			};
	  }
	| {
			name: "review_decided";
			params: { actor: "user" | "agent"; verdict: "approved" | "changes_requested" };
	  }
	| {
			name: "pr_action_finished";
			params: {
				action: "created" | "updated" | "pushed" | "compare" | "unknown";
				outcome: "succeeded" | "failed";
				reason: AnalyticsFailureReason;
			};
	  };

export type AnalyticsEvent = BasicAnalyticsEvent | AdditionalAnalyticsEvent;
export type AdditionalAnalyticsCapture = (event: AdditionalAnalyticsEvent) => void;

export function bucketDuration(durationMs: number): AnalyticsDurationBucket {
	if (!Number.isFinite(durationMs) || durationMs < 0) return "unknown";
	if (durationMs < 10_000) return "<10s";
	if (durationMs < 60_000) return "10–59s";
	if (durationMs < 300_000) return "1–4m";
	if (durationMs < 900_000) return "5–14m";
	return "15m+";
}

export function bucketCount(count: number): AnalyticsCountBucket {
	if (!Number.isInteger(count) || count < 0) return "unknown";
	if (count === 0) return "0";
	if (count === 1) return "1";
	if (count < 5) return "2–4";
	return "5+";
}

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
