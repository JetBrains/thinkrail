/** A live `select` awaiting the user's choice (`provider.loginReply` with the option id). */
export interface LoginInputSelect {
	kind: "select";
	message: string;
	options: { id: string; label: string }[];
}
/** A live `prompt` awaiting typed text / a pasted code (`provider.loginReply` with the string). */
export interface LoginInputPrompt {
	kind: "prompt";
	message: string;
	placeholder?: string;
	/** pi allows a blank answer here (e.g. Copilot's "blank for github.com") — the dialog may submit empty. */
	allowEmpty?: boolean;
}
export type LoginInput = LoginInputSelect | LoginInputPrompt;

/**
 * The client-accumulated state of one in-app OAuth login. Frames **accumulate** into it (they don't
 * replace): `url` (open the browser) can be live at the same time as `input` (paste the code) — the
 * anthropic/openai browser-vs-paste race. `status` goes `active` → `success`/`error` (terminal).
 */
export interface LoginState {
	loginId: string;
	providerId: string;
	status: "active" | "success" | "error";
	/** OAuth URL to open in a browser (`onAuth`). */
	url?: string;
	instructions?: string;
	/** Device-code flow: show the code and the verification URL; the provider polls, no input needed. */
	deviceCode?: { userCode: string; verificationUri: string; expiresInSeconds?: number };
	/** A live select/prompt awaiting the user's answer. */
	input?: LoginInput;
	/** A transient status line (`onProgress`). */
	progress?: string;
	/** The failure message when `status === "error"`. */
	error?: string;
}
