import type {
	AppConfig,
	JbcentralConnectResult,
	OpenPrResult,
	ProviderStatusReport,
	ReviewComment,
} from "@thinkrail/contracts";
import { isJbcentralConnected } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import { settledAvailableModels, usePiRuntime } from "../agent";
import {
	type AdditionalAnalyticsCapture,
	type AdditionalAnalyticsEvent,
	getAdditionalAnalyticsCapture,
	type PlanActionSource,
	type ReviewCommentActor,
	type ReviewResolveOutcome,
} from "../analytics";
import { listProjects } from "../projects";

type SetupState = Extract<AdditionalAnalyticsEvent, { name: "setup_state_observed" }>["params"];
type SetupResult = Extract<AdditionalAnalyticsEvent, { name: "setup_action_finished" }>["params"];
type FailureReason = SetupResult["reason"];

export function additionalAnalyticsEnabled(
	config: Pick<AppConfig, "analyticsEnabled" | "analyticsConsentConfirmed">,
): boolean {
	return config.analyticsEnabled && config.analyticsConsentConfirmed;
}

export function additionalCapture(): AdditionalAnalyticsCapture | null {
	try {
		return getAdditionalAnalyticsCapture();
	} catch {
		return null;
	}
}

export function captureAdditional(
	capture: AdditionalAnalyticsCapture | null,
	event: AdditionalAnalyticsEvent,
): void {
	try {
		capture?.(event);
	} catch {}
}

// The grant is captured at the operation's synchronous entry and passed in (never re-read here): a
// pre-consent action finishing after enablement must not emit through the new grant. The grant
// closure self-guards, so a stale token is inert after revoke/re-enable (see analytics/SPEC.md).
export function captureReviewCommentAdded(
	capture: AdditionalAnalyticsCapture | null,
	comment: ReviewComment,
): void {
	captureAdditional(capture, {
		name: "review_comment_added",
		params: {
			author: comment.author === "agent" ? "agent" : "user",
			kind: comment.kind,
		},
	});
}

/** One event per comment (not per send action), so added→sent→resolved is a countable funnel. */
export function captureReviewCommentsSent(
	capture: AdditionalAnalyticsCapture | null,
	comments: readonly ReviewComment[],
): void {
	for (const comment of comments) {
		captureAdditional(capture, {
			name: "review_comment_sent",
			params: { outdated: comment.anchorState === "outdated" ? "yes" : "no" },
		});
	}
}

export function captureReviewCommentResolved(
	capture: AdditionalAnalyticsCapture | null,
	actor: ReviewCommentActor,
	outcome: ReviewResolveOutcome,
): void {
	captureAdditional(capture, {
		name: "review_comment_resolved",
		params: { actor, outcome },
	});
}

export function failureReason(error: unknown): FailureReason {
	if (errorCodeOf(error) === "PUSH_AUTH_FAILED") return "auth";
	return "unknown";
}

export function providerAvailability(
	report: ProviderStatusReport,
): SetupState["provider_available"] {
	if (
		report.providers.some((provider) => provider.configured) ||
		isJbcentralConnected(report.jbcentral)
	)
		return "yes";
	switch (report.jbcentral.state) {
		case "probe-failed":
		case "configuring":
		case "load-failed":
			return "unknown";
		default:
			return "no";
	}
}

export class SetupObservation {
	private grant: AdditionalAnalyticsCapture | null = null;
	private state: SetupState | undefined;

	constructor(private readonly getCapture = additionalCapture) {}

	observe(capture: AdditionalAnalyticsCapture | null, update: Partial<SetupState>): void {
		if (!capture || capture !== this.getCapture()) return;
		if (this.grant !== capture) {
			this.grant = capture;
			this.state = undefined;
		}
		const next: SetupState = {
			provider_available: update.provider_available ?? this.state?.provider_available ?? "unknown",
			model_available: update.model_available ?? this.state?.model_available ?? "unknown",
			project_present: update.project_present ?? this.state?.project_present ?? "unknown",
		};
		if (
			this.state?.provider_available === next.provider_available &&
			this.state.model_available === next.model_available &&
			this.state.project_present === next.project_present
		)
			return;
		this.state = next;
		captureAdditional(capture, { name: "setup_state_observed", params: next });
	}

	clear(): void {
		this.grant = null;
		this.state = undefined;
	}
}

export const setupObservation = new SetupObservation();

async function currentSetupState(): Promise<SetupState> {
	const project_present = listProjects().length > 0 ? "yes" : "no";
	try {
		return await usePiRuntime((runtime, generation) => {
			const modelsAvailable = settledAvailableModels(runtime).length > 0;
			const providerAvailable =
				modelsAvailable ||
				[...generation.providerStatusIds].some(
					(provider) => runtime.getProviderAuthStatus(provider).configured,
				);
			return {
				project_present,
				provider_available: providerAvailable ? "yes" : "no",
				model_available: modelsAvailable ? "yes" : "no",
			};
		});
	} catch {
		return { project_present, provider_available: "unknown", model_available: "unknown" };
	}
}

export async function observeCurrentSetup(read = currentSetupState): Promise<void> {
	const capture = additionalCapture();
	if (!capture) return;
	try {
		setupObservation.observe(capture, await read());
	} catch {}
}

export async function observeSetupRead<T>(
	read: () => T | Promise<T>,
	state: (result: T) => Partial<SetupState>,
): Promise<T> {
	const capture = additionalCapture();
	const result = await read();
	if (capture && capture === additionalCapture()) {
		try {
			setupObservation.observe(capture, state(result));
		} catch {}
	}
	return result;
}

export async function observeSetupAction<T>(
	action: SetupResult["action"],
	operation: () => T | Promise<T>,
	resultOf: (result: T) => Pick<SetupResult, "outcome" | "reason"> = () => ({
		outcome: "succeeded",
		reason: "none",
	}),
): Promise<T> {
	const capture = additionalCapture();
	let result: T;
	try {
		result = await operation();
	} catch (error) {
		captureAdditional(capture, {
			name: "setup_action_finished",
			params: { action, outcome: "failed", reason: failureReason(error) },
		});
		throw error;
	}
	if (capture && capture === additionalCapture()) {
		try {
			const { outcome, reason } = resultOf(result);
			captureAdditional(capture, {
				name: "setup_action_finished",
				params: { action, outcome, reason },
			});
		} catch {}
	}
	return result;
}

export function centralConnectOutcome(
	result: JbcentralConnectResult,
): Pick<SetupResult, "outcome" | "reason"> {
	if (result.outcome === "applied") return { outcome: "succeeded", reason: "none" };
	return {
		outcome: "failed",
		reason:
			result.reason === "unsupported-version" || result.reason === "not-installed"
				? "unsupported"
				: "unknown",
	};
}

export async function observePrAction(
	operation: () => Promise<OpenPrResult>,
	source: PlanActionSource = "other",
): Promise<OpenPrResult> {
	const capture = additionalCapture();
	let result: OpenPrResult;
	try {
		result = await operation();
	} catch (error) {
		captureAdditional(capture, {
			name: "pr_action_finished",
			params: { action: "unknown", outcome: "failed", reason: failureReason(error), source },
		});
		throw error;
	}
	if (capture && capture === additionalCapture()) {
		try {
			const failedUpdate = result.action === "updated" && result.bodyRefreshed !== true;
			captureAdditional(capture, {
				name: "pr_action_finished",
				params: {
					action: result.action,
					outcome: failedUpdate ? "failed" : "succeeded",
					reason: failedUpdate
						? "unknown"
						: result.action === "compare" && result.ghProblem
							? result.ghProblem === "missing"
								? "unsupported"
								: "auth"
							: "none",
					source,
				},
			});
		} catch {}
	}
	return result;
}
