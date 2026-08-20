import type { AuthType } from "@earendil-works/pi-ai";
import type { LoginPush } from "@thinkrail/contracts";
import { bucketProvider, type LoginMethod, track } from "../analytics";

const methodByLoginId = new Map<string, LoginMethod>();

export function recordLoginStart(loginId: string, type: AuthType): void {
	methodByLoginId.set(loginId, type === "api_key" ? "api-key" : "oauth");
}

export function dropLogin(loginId: string): void {
	methodByLoginId.delete(loginId);
}

export function trackLoginOutcome(push: LoginPush): void {
	if (push.frame.kind !== "success" && push.frame.kind !== "error") return;
	const method = methodByLoginId.get(push.loginId);
	methodByLoginId.delete(push.loginId);
	if (push.frame.kind !== "success" || !method) return;
	track({
		name: "provider_login",
		params: { provider: bucketProvider(push.providerId), method },
	});
}
