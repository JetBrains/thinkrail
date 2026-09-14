import type { AuthType } from "@earendil-works/pi-ai";
import type { LoginPush } from "@thinkrail/contracts";
import type { PiRuntimeGeneration } from "../agent";
import {
	type AdditionalAnalyticsCapture,
	bucketProvider,
	type LoginMethod,
	track,
} from "../analytics";
import { loginAuthMethod } from "./authAnalytics";
import { additionalCapture, captureAdditional } from "./productAnalytics";

const methodByLoginId = new Map<
	string,
	{ method: LoginMethod; capture: AdditionalAnalyticsCapture | null }
>();

export function recordLoginStart(
	loginId: string,
	type: AuthType,
	capture = additionalCapture(),
): void {
	methodByLoginId.set(loginId, { method: type === "api_key" ? "api-key" : "oauth", capture });
}

export function dropLogin(loginId: string): void {
	const login = methodByLoginId.get(loginId);
	methodByLoginId.delete(loginId);
	captureAdditional(login?.capture ?? null, {
		name: "setup_action_finished",
		params: { action: "provider_connect", outcome: "cancelled", reason: "none" },
	});
}

export function trackLoginOutcome(push: LoginPush, generation?: PiRuntimeGeneration): void {
	if (push.frame.kind !== "success" && push.frame.kind !== "error") return;
	const login = methodByLoginId.get(push.loginId);
	methodByLoginId.delete(push.loginId);
	if (!login) return;
	captureAdditional(login.capture, {
		name: "setup_action_finished",
		params: {
			action: "provider_connect",
			outcome: push.frame.kind === "success" ? "succeeded" : "failed",
			reason: push.frame.kind === "success" ? "none" : "unknown",
		},
	});
	if (push.frame.kind !== "success") return;
	track({
		name: "provider_login",
		params: {
			provider: bucketProvider(push.providerId),
			method: login.method,
			auth_method: loginAuthMethod(push.providerId, login.method, generation),
		},
	});
}
