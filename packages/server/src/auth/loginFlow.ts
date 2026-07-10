// The pi OAuth bridge: `auth.login` starts `authStorage.login(providerId, callbacks)` on the host and
// maps pi's `OAuthLoginCallbacks` onto serialized `AuthEvent` frames — the browser answers the blocking
// ones (`prompt` / `select` / `manual-code`) via `auth.answer`, correlated by `requestId`. This is the
// same shape as the extension-UI dialog bridge, minus sessions (auth is app-level).

import type { AuthEvent, AuthFlowStart } from "@thinkrail/contracts";
import { getPiRuntime } from "../agent";
import { publishAuthEvent } from "./events";
import { type ActiveFlow, cancelFlow, finishFlow, flowStart, startFlow } from "./flows";
import { openBrowser } from "./openBrowser";
import { refreshAuthAndModels } from "./refresh";

/** A blocking question waiting on the browser (`prompt` / `select` / `manual-code`). */
interface PendingAnswer {
	flowId: string;
	resolve: (value: string | null) => void;
}

const pending = new Map<string, PendingAnswer>();

/** Register a question, publish its event, and await the browser's `auth.answer`. */
function ask(flow: ActiveFlow, build: (requestId: string) => AuthEvent): Promise<string | null> {
	const requestId = crypto.randomUUID();
	return new Promise<string | null>((resolve) => {
		pending.set(requestId, { flowId: flow.id, resolve });
		// A cancelled flow settles every question it still has in flight.
		flow.controller.signal.addEventListener("abort", () => {
			if (pending.delete(requestId)) resolve(null);
		});
		publishAuthEvent(build(requestId));
	});
}

/** The `auth.answer` handler: settle a pending question. Unknown ids throw (stale client). */
export function answerAuth(requestId: string, value: string | null): void {
	const entry = pending.get(requestId);
	if (!entry) throw new Error(`Unknown auth request: ${requestId}`);
	pending.delete(requestId);
	entry.resolve(value);
}

/** The `auth.cancel` handler. */
export function cancelAuthFlow(flowId: string): void {
	cancelFlow(flowId);
}

/** Start a subscription OAuth flow. Throws synchronously on an unknown provider. */
export function startOAuthLogin(providerId: string): AuthFlowStart {
	const { authStorage } = getPiRuntime();
	const provider = authStorage.getOAuthProviders().find((p) => p.id === providerId);
	if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);
	const flow = startFlow("oauth", providerId);
	void runOAuthLogin(flow, providerId);
	return flowStart(flow);
}

async function runOAuthLogin(flow: ActiveFlow, providerId: string): Promise<void> {
	const { authStorage } = getPiRuntime();
	const { signal } = flow.controller;
	try {
		await authStorage.login(providerId, {
			onAuth: (info) => {
				publishAuthEvent({
					kind: "auth-url",
					flowId: flow.id,
					url: info.url,
					...(info.instructions ? { instructions: info.instructions } : {}),
				});
				openBrowser(info.url);
			},
			onDeviceCode: (info) => {
				publishAuthEvent({
					kind: "device-code",
					flowId: flow.id,
					userCode: info.userCode,
					verificationUri: info.verificationUri,
					...(info.expiresInSeconds ? { expiresInSeconds: info.expiresInSeconds } : {}),
				});
			},
			onProgress: (message) => {
				publishAuthEvent({ kind: "progress", flowId: flow.id, message });
			},
			onPrompt: async (prompt) => {
				const value = await ask(flow, (requestId) => ({
					kind: "prompt",
					flowId: flow.id,
					requestId,
					message: prompt.message,
					...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
					...(prompt.allowEmpty !== undefined ? { allowEmpty: prompt.allowEmpty } : {}),
				}));
				// A dismissed prompt can't be substituted — treat it as a user cancel of the flow.
				if (value === null) {
					flow.controller.abort();
					throw new Error("cancelled");
				}
				return value;
			},
			onSelect: async (prompt) => {
				const value = await ask(flow, (requestId) => ({
					kind: "select",
					flowId: flow.id,
					requestId,
					message: prompt.message,
					options: prompt.options,
				}));
				return value ?? undefined; // null → undefined = pi's own cancel semantics for selects
			},
			// The manual paste box races the provider's callback server: it resolves only when the user
			// actually submits a code (a null answer just re-arms it — the browser path may still win).
			onManualCodeInput: () => waitForManualCode(flow),
			signal,
		});
		refreshAuthAndModels();
		finishFlow(flow, true);
	} catch (err) {
		const aborted = signal.aborted;
		const message = err instanceof Error ? err.message : String(err);
		finishFlow(flow, false, aborted ? "cancelled" : message);
	}
}

async function waitForManualCode(flow: ActiveFlow): Promise<string> {
	// Re-ask until a non-empty code arrives; a cancelled flow resolves the ask with null and the
	// abort signal ends the surrounding login, so this loop can't outlive its flow.
	for (;;) {
		const value = await ask(flow, (requestId) => ({
			kind: "manual-code",
			flowId: flow.id,
			requestId,
		}));
		if (flow.controller.signal.aborted) throw new Error("cancelled");
		if (value && value.trim() !== "") return value.trim();
	}
}
