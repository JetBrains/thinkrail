// In-app provider login: drives pi's login flows (`ModelRuntime.login`) headless — the `AuthInteraction`
// pi would hand a TUI is wired to WS frames instead. One bridge serves BOTH auth types: `"oauth"` and
// `"api_key"` (the provider-owned interactive key entry — a single secret prompt for most, multi-prompt
// for azure/vertex-style creds). Session-less (a login runs on the Welcome screen before any session
// exists), so this is the sibling of `webUiContext`: a `loginId`-keyed pending registry, frames pushed
// on the `provider.login` channel, and a parked input promise that the browser's `provider.loginReply`
// resolves. Also the logout mutator; every write is persisted by pi to auth.json and followed by its
// internal availability refresh, so a following `provider.status` read reflects it.

import type { AuthInteraction, AuthPrompt, AuthType } from "@earendil-works/pi-ai";
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
	/** Resolver for the currently-parked `select`/`prompt` interaction, if one is awaiting input. */
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

/** The wire frame for an interactive `AuthPrompt` (select keeps its options; the rest are text inputs). */
function frameForPrompt(prompt: AuthPrompt): LoginFrame {
	if (prompt.type === "select") {
		return {
			kind: "select",
			message: prompt.message,
			options: prompt.options.map((o) => ({ id: o.id, label: o.label })),
		};
	}
	// `text`, `secret`, and `manual_code` all collect one string (the paste-code race included). Only
	// `text` prompts may be submitted blank — providers define empty semantics there (Copilot's GHE
	// prompt treats blank as github.com), while an empty secret/auth-code is never meaningful. A `secret`
	// prompt (an API key) is flagged so the dialog masks the input.
	return {
		kind: "prompt",
		message: prompt.message,
		...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
		...(prompt.type === "text" ? { allowEmpty: true } : {}),
		...(prompt.type === "secret" ? { secret: true } : {}),
	};
}

/**
 * Start a login and return its handle **immediately** — pi's `ModelRuntime.login()` is kicked off
 * *detached* (`void`, no `await`): a flow can take minutes of user interaction (OAuth round-trips, or
 * hunting down an API key to paste), so awaiting it here would blow the client's request timeout and
 * block the WS message pump. Frames arrive on the `provider.login` channel; the terminal
 * `success`/`error` frame lands whenever the detached flow settles. `type` picks the provider-owned
 * flow: `"oauth"` (default) or `"api_key"` (interactive key entry — pi persists it to auth.json, unlike
 * the non-persistent `setRuntimeApiKey` overlay).
 */
export function startLogin(providerId: string, type: AuthType = "oauth"): { loginId: string } {
	const loginId = nextId();
	const entry: Pending = { providerId, abort: new AbortController(), settled: false };
	logins.set(loginId, entry);

	// Guard on `settled`: interaction callbacks fire from the detached flow and could race a
	// `cancelLogin`/terminal — never publish a frame for a login that's already been terminated.
	const push = (frame: LoginFrame): void => {
		if (!entry.settled) publish({ loginId, providerId, frame });
	};

	// Park a `select`/`prompt` frame and await the browser's reply (or a cancel → `undefined`). pi aborts
	// a prompt it no longer wants (e.g. the manual-code prompt when its callback server wins the race) via
	// the prompt's own signal — settle with `undefined` then, so a late browser reply can't leak into a
	// future prompt.
	const awaitInput = (frame: LoginFrame, signal?: AbortSignal): Promise<string | undefined> =>
		new Promise((resolve) => {
			const settle = (value: string | undefined): void => {
				// Identity guard: a late abort from a superseded prompt must not clear a newer parked one.
				if (entry.resolveInput === settle) delete entry.resolveInput;
				resolve(value); // resolving an already-settled promise is a no-op
			};
			entry.resolveInput = settle;
			signal?.addEventListener("abort", () => settle(undefined), { once: true });
			push(frame);
		});

	const interaction: AuthInteraction = {
		signal: entry.abort.signal,
		notify: (event) => {
			switch (event.type) {
				case "auth_url":
					push({
						kind: "authUrl",
						url: event.url,
						...(event.instructions ? { instructions: event.instructions } : {}),
					});
					break;
				case "device_code":
					push({
						kind: "deviceCode",
						userCode: event.userCode,
						verificationUri: event.verificationUri,
						...(event.expiresInSeconds ? { expiresInSeconds: event.expiresInSeconds } : {}),
					});
					break;
				case "progress":
					push({ kind: "progress", message: event.message });
					break;
				case "info":
					// Informational text (may carry links) — render as progress, links appended as plain URLs.
					push({
						kind: "progress",
						message: [event.message, ...(event.links ?? []).map((l) => l.url)].join(" "),
					});
					break;
			}
		},
		prompt: async (prompt) => {
			const value = await awaitInput(frameForPrompt(prompt), prompt.signal);
			// `undefined` = cancelled (ours) or abandoned (pi's own abort) — throwing unblocks pi's flow;
			// when pi aborted the prompt itself, the rejection is absorbed by its already-settled race.
			if (value === undefined) throw new Error("Login cancelled");
			return value;
		},
	};

	// Terminal frames are published directly (bypassing `push`'s settled-guard): `terminate()` flips `settled`
	// first, and it also guarantees exactly one terminal outcome per login.
	const publishTerminal = (frame: LoginFrame): void => publish({ loginId, providerId, frame });

	// pi persists the credential and refreshes its availability snapshot inside `login()` — the freshly
	// authed provider's models appear on the next `model.list`/`provider.status` read with no extra step.
	void getPiRuntime()
		.then((runtime) => runtime.login(providerId, type, interaction))
		.then(() => {
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

/** The browser's answer to a live `select`/`prompt` frame — resolves the parked interaction. */
export function resolveLogin(reply: LoginReply): void {
	logins.get(reply.loginId)?.resolveInput?.(reply.value);
}

/**
 * Cancel an in-flight login. Aborting the signal alone does NOT stop a provider's browser/callback-server
 * wait (pi uses its own internal timeout there), so we also settle any parked input with `undefined` — which
 * makes the awaiting `prompt` throw, unblocking pi's flow.
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

/** Remove a provider's stored credentials (auth.json); pi refreshes availability internally. */
export async function logoutProvider(providerId: string): Promise<void> {
	const runtime = await getPiRuntime();
	await runtime.logout(providerId);
}
