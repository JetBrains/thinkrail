// Provider-auth wire types — the connect-a-provider gate + Settings→Providers surface.
//
// These are OUR wire shapes (like `ExtUiRequest`), not pi re-exports: the server maps pi's
// `OAuthLoginCallbacks` onto `AuthEvent` frames so the browser never touches a pi package. Credential
// VALUES never ride the read side — `AuthProviderStatus` carries status/labels only; the one write-side
// exception is the `auth.setApiKey` key paste (client→host, once).

/** How a provider authenticates: a subscription OAuth flow, or a pasted API key. */
export type AuthProviderKind = "oauth" | "api_key";

/** One provider row of the connect surface / Settings→Providers. */
export interface AuthProviderStatus {
	/** pi provider id (`anthropic`, `openai-codex`, `github-copilot`, `openai`, `groq`, …). */
	id: string;
	/** Display name (pi's, e.g. "Claude Pro/Max" for the anthropic OAuth flow). */
	name: string;
	kind: AuthProviderKind;
	/** Featured tiles (the OAuth trio) render above the API-key catalog. */
	featured?: boolean;
	/** Whether any auth is configured (stored key/OAuth, env var, or models.json key). */
	authenticated: boolean;
	/** Where the auth came from when configured (pi's `AuthStatus.source`, e.g. `environment`). */
	source?: string;
	/** Human label for the source (pi's `AuthStatus.label`). */
	label?: string;
	/** The conventional env var that also unlocks this provider (a UI hint, api_key kind only). */
	envVar?: string;
}

/** jbcentral (JetBrains Central CLI) probe — drives the JetBrains AI tile's entry state. */
export interface JbcentralStatus {
	/** `jbcentral` resolves on the host (PATH or a well-known install dir). */
	installed: boolean;
	/** models.json currently routes anthropic/openai through the local proxy. */
	wired: boolean;
}

/** `auth.status` result: everything the gate + Settings need in one read. */
export interface AuthStatusResult {
	providers: AuthProviderStatus[];
	jbcentral: JbcentralStatus;
	/** `model.list`'s size — the gate shows while this is 0. */
	modelCount: number;
}

/** Which long-running auth flow a `flowId` belongs to. */
export type AuthFlowKind = "oauth" | "jb-install" | "jb-login" | "jb-configure";

/** Handle returned by every flow-starting method; its events stream on the `auth.event` channel. */
export interface AuthFlowStart {
	flowId: string;
}

/**
 * Server→client frames on the `auth.event` channel. `prompt` / `select` / `manual-code` expect a
 * `auth.answer` reply correlated by `requestId`; everything else is display-only. `changed` is the
 * global invalidation (no flow): re-fetch `auth.status` + `model.list`.
 */
export type AuthEvent =
	| { kind: "flow-started"; flowId: string; flow: AuthFlowKind; providerId?: string }
	/** OAuth: open/copy this URL (the host already tried opening the browser). */
	| { kind: "auth-url"; flowId: string; url: string; instructions?: string }
	/** Device-code OAuth (Copilot): show the code + verification URL. */
	| {
			kind: "device-code";
			flowId: string;
			userCode: string;
			verificationUri: string;
			expiresInSeconds?: number;
	  }
	/** A manual-code paste box may be shown; it races the browser callback. */
	| { kind: "manual-code"; flowId: string; requestId: string }
	/** Free-text question (e.g. Copilot's GitHub Enterprise domain). Reply via `auth.answer`. */
	| {
			kind: "prompt";
			flowId: string;
			requestId: string;
			message: string;
			placeholder?: string;
			allowEmpty?: boolean;
	  }
	/** Choice question. Reply via `auth.answer` with the option id (null = cancel). */
	| {
			kind: "select";
			flowId: string;
			requestId: string;
			message: string;
			options: { id: string; label: string }[];
	  }
	| { kind: "progress"; flowId: string; message: string }
	/** Raw output line from a jbcentral step (install/login/add) — the wizard's log tail. */
	| { kind: "log"; flowId: string; line: string }
	/** jbcentral step transitions (`install` / `login` / `add-claude` / `add-codex` / `wire-proxy` / `reload-models`). */
	| {
			kind: "step";
			flowId: string;
			step: string;
			status: "start" | "ok" | "error";
			detail?: string;
	  }
	/** Terminal frame of a flow. `ok:false` carries the failure message; the flow is retryable. */
	| { kind: "done"; flowId: string; ok: boolean; message?: string }
	/** Auth/model state changed (any source) — clients re-fetch `auth.status` + `model.list`. */
	| { kind: "changed"; modelCount: number };
