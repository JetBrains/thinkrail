// Correlates `provider.loginStart`'s auth type with the login channel's terminal frame so
// `provider_login` can carry the method (`oauth` / `api-key`). The host is the only place both ends
// meet: the `auth` module stays analytics-free (it may not import `analytics`), and the wire stays
// free of analytics-serving fields — so the loginStart handler records the method here and the
// login-publisher tee in `createServer` looks it up on the terminal frame.
import type { AuthType } from "@earendil-works/pi-ai";
import type { LoginPush } from "@thinkrail/contracts";
import { bucketProvider, type LoginMethod, track } from "../analytics";

const methodByLoginId = new Map<string, LoginMethod>();

/** Called by the `provider.loginStart` handler: remember which flow this login runs. */
export function recordLoginStart(loginId: string, type: AuthType): void {
	methodByLoginId.set(loginId, type === "api_key" ? "api-key" : "oauth");
}

/** Called by the `provider.loginCancel` handler — a cancelled login never tracks. */
export function dropLogin(loginId: string): void {
	methodByLoginId.delete(loginId);
}

/**
 * The login-publisher tee: a terminal `success` frame is the `provider_login` moment — provider
 * bucketed, method from the recorded start. Terminal frames (success or error) clear the entry; a
 * success with no recorded start tracks nothing (fails closed — never a guessed method).
 */
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
