// In-app provider login: drives pi's OAuth flow (`authStorage.login`) headless — the callbacks pi would
// hand a TUI are wired to WS frames instead. Session-less (a login runs on the Welcome screen before any
// session exists), so this is the sibling of `webUiContext`: a `loginId`-keyed pending registry, frames
// pushed on the `provider.login` channel, and a parked input promise that the browser's `provider.loginReply`
// resolves. Also the API-key / logout mutators (auth.json writes), each of which refreshes the registry so
// a following `provider.status` read reflects it.

import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import type { LoginFrame, LoginPush, LoginReply } from "@thinkrail/contracts";
import { getPiRuntime } from "../agent";

let publish: (push: LoginPush) => void = () => {};
/** Wired in `createServer` to push frames on the `provider.login` channel (defaults to a no-op). */
export function setLoginPublisher(fn: (push: LoginPush) => void): void {
	publish = fn;
}

let seq = 0;
const nextId = (): string => `login_${++seq}`;

/** An in-flight login awaiting completion (and, when a `select`/`prompt` is live, the browser's answer). */
interface Pending {
	providerId: string;
	abort: AbortController;
	/** Resolver for the currently-parked `select`/`prompt`/manual-code callback, if one is awaiting input. */
	resolveInput?: (value: string | undefined) => void;
	settled: boolean;
}
const logins = new Map<string, Pending>();

/** Settle+remove a login exactly once. Returns the entry so the caller can push a terminal frame / abort. */
function terminate(loginId: string): Pending | undefined {
	const entry = logins.get(loginId);
	if (!entry || entry.settled) return undefined;
	entry.settled = true;
	logins.delete(loginId);
	return entry;
}

/**
 * Start a login and return its handle **immediately** — pi's `authStorage.login()` is kicked off *detached*
 * (`void`, no `await`): an OAuth flow can take minutes of user interaction, so awaiting it here would blow
 * the client's request timeout and block the WS message pump. Frames arrive on the `provider.login` channel;
 * the terminal `success`/`error` frame lands whenever the detached flow settles.
 */
export function startLogin(providerId: string): { loginId: string } {
	const loginId = nextId();
	const entry: Pending = { providerId, abort: new AbortController(), settled: false };
	logins.set(loginId, entry);

	const { authStorage, modelRegistry } = getPiRuntime();
	// Guard on `settled`: pi's callbacks (onAuth/onProgress/…) fire from the detached flow and could race a
	// `cancelLogin`/terminal — never publish a frame for a login that's already been terminated.
	const push = (frame: LoginFrame): void => {
		if (!entry.settled) publish({ loginId, providerId, frame });
	};

	// Park a `select`/`prompt` frame and await the browser's reply (or a cancel → `undefined`).
	const awaitInput = (frame: LoginFrame): Promise<string | undefined> =>
		new Promise((resolve) => {
			entry.resolveInput = (value) => {
				delete entry.resolveInput;
				resolve(value);
			};
			push(frame);
		});

	const callbacks: OAuthLoginCallbacks = {
		onAuth: (info) =>
			push({
				kind: "authUrl",
				url: info.url,
				...(info.instructions ? { instructions: info.instructions } : {}),
			}),
		onDeviceCode: (info) =>
			push({
				kind: "deviceCode",
				userCode: info.userCode,
				verificationUri: info.verificationUri,
				...(info.expiresInSeconds ? { expiresInSeconds: info.expiresInSeconds } : {}),
			}),
		onProgress: (message) => push({ kind: "progress", message }),
		onSelect: (prompt) =>
			awaitInput({ kind: "select", message: prompt.message, options: prompt.options }),
		onPrompt: async (prompt) => {
			const value = await awaitInput({
				kind: "prompt",
				message: prompt.message,
				...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
				// pi flags prompts where an empty answer is valid (e.g. GitHub Copilot's "blank for github.com"
				// GHE domain) — forward it so the dialog can let the user submit blank instead of dead-ending.
				...(prompt.allowEmpty ? { allowEmpty: true } : {}),
			});
			if (value === undefined) throw new Error("Login cancelled");
			return value;
		},
		// Runs *concurrently* with `onAuth`'s local callback server (the anthropic/openai browser-vs-paste
		// race): the user opens the URL, or pastes the code here — whichever wins settles the flow. On remote
		// access (localhost callback unreachable), paste is the only path, so this must always be offered.
		onManualCodeInput: async () => {
			const value = await awaitInput({
				kind: "prompt",
				message: "Paste the authorization code from your browser",
				placeholder: "authorization code",
			});
			if (value === undefined) throw new Error("Login cancelled");
			return value;
		},
		signal: entry.abort.signal,
	};

	// Terminal frames are published directly (bypassing `push`'s settled-guard): `terminate()` flips `settled`
	// first, and it also guarantees exactly one terminal outcome per login.
	const publishTerminal = (frame: LoginFrame): void => publish({ loginId, providerId, frame });

	void authStorage
		.login(providerId, callbacks)
		.then(() => {
			// pi's `login()` writes auth.json but does NOT touch the registry — refresh so the freshly-authed
			// provider's models appear (otherwise `model.list`/`provider.status` stay stale: authed but invisible).
			modelRegistry.refresh();
			if (terminate(loginId)) publishTerminal({ kind: "success" });
		})
		.catch((err: unknown) => {
			// A cancel already terminated the entry (and caused this rejection) — don't emit a stray error frame.
			if (terminate(loginId)) {
				publishTerminal({
					kind: "error",
					message: err instanceof Error ? err.message : String(err),
				});
			}
		});

	return { loginId };
}

/** The browser's answer to a live `select`/`prompt` frame — resolves the parked pi callback. */
export function resolveLogin(reply: LoginReply): void {
	logins.get(reply.loginId)?.resolveInput?.(reply.value);
}

/**
 * Cancel an in-flight login. Aborting the signal alone does NOT stop a provider's browser/callback-server
 * wait (pi uses its own internal timeout there), so we also settle any parked input with `undefined` — which
 * makes the awaiting `onPrompt`/`onManualCodeInput` throw, unblocking pi's flow.
 */
export function cancelLogin(loginId: string): void {
	const entry = terminate(loginId);
	if (!entry) return;
	entry.abort.abort();
	entry.resolveInput?.(undefined);
}

/** Cancel every in-flight login (host shutdown) so no detached `login()` promise leaks past `stop()`. */
export function cancelAllLogins(): void {
	for (const loginId of [...logins.keys()]) cancelLogin(loginId);
}

/** Store a single API key for a provider (auth.json) and refresh the registry so it takes effect at once. */
export function setProviderApiKey(providerId: string, key: string): void {
	const trimmed = key.trim();
	if (!trimmed) throw new Error("API key must not be empty");
	const { authStorage, modelRegistry } = getPiRuntime();
	authStorage.set(providerId, { type: "api_key", key: trimmed });
	modelRegistry.refresh();
}

/** Remove a provider's stored credentials (auth.json) and refresh the registry. */
export function logoutProvider(providerId: string): void {
	const { authStorage, modelRegistry } = getPiRuntime();
	authStorage.logout(providerId);
	modelRegistry.refresh();
}
