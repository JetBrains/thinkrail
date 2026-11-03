import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/oauth";
import { logger } from "../../log";
import { defaultProjectId, loadCodeAssist } from "./client";

const log = logger("agent");

export const REDIRECT_URI = "http://localhost:51121/oauth-callback";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
export const SCOPES = [
	"https://www.googleapis.com/auth/aicode",
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
];

const CLIENT_ID_PARTS = [
	"1071006060591-tmhssin2h21lcre235vtolojh4g403ep",
	"apps",
	"googleusercontent",
	"com",
] as const;

const CLIENT_SECRET_PARTS = ["GOCSPX", "K58FWR486LdLJ1mLB8sXC4z6qDAf"] as const;

export const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || CLIENT_ID_PARTS.join(".");
export const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || CLIENT_SECRET_PARTS.join("-");

function base64Url(buffer: Buffer): string {
	return buffer.toString("base64url");
}

export function generatePKCE(): { verifier: string; challenge: string } {
	const verifier = base64Url(randomBytes(32));
	const challenge = base64Url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

export function parsePastedCallback(
	raw: string,
	expectedState: string,
): { code: string; state: string } {
	const text = (raw ?? "").trim();
	if (!text) {
		throw new Error("No callback pasted. Paste the callback URL or authorization code.");
	}
	let url: URL | undefined;
	try {
		url = new URL(text);
	} catch {
		if (text.includes("=") || text.includes("&") || text.includes("?")) {
			const qs = text.startsWith("?") ? text.slice(1) : text;
			try {
				url = new URL(`http://localhost:51121/oauth-callback?${qs}`);
			} catch {
				url = undefined;
			}
		}
	}

	if (url) {
		const error = url.searchParams.get("error");
		if (error) throw new Error(`OAuth error from browser: ${error.slice(0, 200)}`);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		if (code) {
			if (state && state !== expectedState) {
				throw new Error("State mismatch: that callback is from a different sign-in.");
			}
			return { code, state: expectedState };
		}
	}

	if (!text.includes(" ") && text.length > 5) {
		return { code: text, state: expectedState };
	}

	throw new Error("Pasted text is missing authorization code.");
}

export type CallbackRequestResult =
	| {
			ok: true;
			status: 200;
			body: string;
			code: string;
			state: string;
	  }
	| {
			ok: false;
			status: number;
			body: string;
			error: string;
	  };

export function handleCallbackRequest(
	req: { method?: string | undefined; url?: string | undefined },
	expectedState: string,
): CallbackRequestResult {
	if (req.method !== "GET" && req.method !== "HEAD") {
		return { ok: false, status: 405, body: "Method Not Allowed", error: "Method not allowed" };
	}

	const url = new URL(req.url || "", REDIRECT_URI);
	if (url.pathname !== "/oauth-callback") {
		return {
			ok: false,
			status: 404,
			body: "Antigravity OAuth callback route not found.",
			error: "Route not found",
		};
	}

	const error = url.searchParams.get("error");
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	if (error) {
		return {
			ok: false,
			status: 400,
			body: `Antigravity authentication failed: ${error}`,
			error: `OAuth error: ${error}`,
		};
	}
	if (!code || !state) {
		return {
			ok: false,
			status: 400,
			body: "Antigravity authentication failed: missing code or state.",
			error: "Missing code or state in OAuth callback",
		};
	}
	if (state !== expectedState) {
		return {
			ok: false,
			status: 400,
			body: "Antigravity authentication failed: invalid state.",
			error: "OAuth state mismatch",
		};
	}

	return {
		ok: true,
		status: 200,
		body: "Antigravity authentication complete. You can close this window and return to ThinkRail.",
		code,
		state,
	};
}

interface CallbackServer {
	server: Server | null;
	waitForCode: () => Promise<{ code: string; state: string }>;
	cleanup: () => void;
}

function closeServerGracefully(server: Server): void {
	if (typeof server.closeAllConnections === "function") {
		server.closeAllConnections();
	}
	server.close();
}

async function startCallbackServer(expectedState: string): Promise<CallbackServer> {
	let resolveCode: ((value: { code: string; state: string }) => void) | undefined;
	let rejectCode: ((error: Error) => void) | undefined;
	const codePromise = new Promise<{ code: string; state: string }>((res, rej) => {
		resolveCode = res;
		rejectCode = rej;
	});

	let settled = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;

	const finish = (fn: () => void) => {
		if (settled) return;
		settled = true;
		if (timeout) clearTimeout(timeout);
		fn();
	};

	let serverInstance: Server | null = null;
	try {
		const server = createServer((req, res) => {
			const result = handleCallbackRequest(req, expectedState);
			res.writeHead(result.status, { "Content-Type": "text/plain; charset=utf-8" });
			res.end(result.body);
			if (result.ok) {
				const { code, state } = result;
				finish(() => resolveCode?.({ code, state }));
			} else if (result.status === 400) {
				const { error } = result;
				finish(() => rejectCode?.(new Error(error)));
			}
		});

		await new Promise<void>((resolve) => {
			server.once("error", (err) => {
				log.warn("Antigravity OAuth loopback server failed to bind", { error: String(err) });
				serverInstance = null;
				resolve();
			});
			server.listen(51121, "127.0.0.1", () => {
				serverInstance = server;
				timeout = setTimeout(() => {
					finish(() =>
						rejectCode?.(new Error("OAuth callback timed out waiting for browser login")),
					);
				}, OAUTH_CALLBACK_TIMEOUT_MS);
				if (typeof timeout.unref === "function") timeout.unref();
				resolve();
			});
		});
	} catch (err) {
		log.warn("Antigravity OAuth loopback server setup error", { error: String(err) });
		serverInstance = null;
	}

	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		if (serverInstance) {
			closeServerGracefully(serverInstance);
			serverInstance = null;
		}
	};

	const cleanup = () => {
		finish(() => rejectCode?.(new Error("OAuth callback cancelled")));
		close();
	};

	return {
		server: serverInstance,
		waitForCode: () => codePromise,
		cleanup,
	};
}

export async function promptForCallback(
	promptFn: (opts: { message: string; placeholder: string }) => Promise<string>,
	expectedState: string,
	signal?: AbortSignal,
): Promise<{ code: string; state: string }> {
	let promptMessage = "Paste the callback URL or authorization code:";
	while (true) {
		if (signal?.aborted) throw new Error("Login cancelled");
		const text = await promptFn({
			message: promptMessage,
			placeholder: REDIRECT_URI,
		});
		if (signal?.aborted) throw new Error("Login cancelled");
		try {
			return parsePastedCallback(text, expectedState);
		} catch (err: unknown) {
			if (signal?.aborted) throw new Error("Login cancelled");
			const msg = err instanceof Error ? err.message : String(err);
			promptMessage = `Invalid callback (${msg}). Please paste the callback URL or authorization code:`;
		}
	}
}

async function acquireAuthCode(
	expectedState: string,
	opts: {
		waitForCode: () => Promise<{ code: string; state: string }>;
		callbacks: OAuthLoginCallbacks;
	},
): Promise<{ code: string; state: string }> {
	const { waitForCode, callbacks } = opts;
	const settle = new AbortController();
	const candidates: Promise<{ code: string; state: string }>[] = [waitForCode()];

	if (typeof callbacks.onManualCodeInput === "function") {
		const manualInput = callbacks.onManualCodeInput;
		candidates.push(
			(async () => {
				const text = await manualInput();
				return parsePastedCallback(text, expectedState);
			})(),
		);
	}

	if (typeof callbacks.onPrompt === "function") {
		candidates.push(promptForCallback(callbacks.onPrompt, expectedState, callbacks.signal));
	}

	let removeAbortListener: (() => void) | undefined;
	if (callbacks.signal) {
		const signal = callbacks.signal;
		candidates.push(
			new Promise<never>((_, reject) => {
				if (signal.aborted) {
					reject(new Error("Login cancelled"));
					return;
				}
				const onAbort = () => reject(new Error("Login cancelled"));
				signal.addEventListener("abort", onAbort, { once: true });
				removeAbortListener = () => signal.removeEventListener("abort", onAbort);
			}),
		);
	}

	for (const candidate of candidates) {
		candidate.catch(() => {});
	}

	try {
		return await Promise.race(candidates);
	} finally {
		settle.abort();
		removeAbortListener?.();
	}
}

async function getUserEmail(token: string): Promise<string | undefined> {
	try {
		const res = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) return undefined;
		const data = (await res.json()) as { email?: string };
		return typeof data.email === "string" ? data.email : undefined;
	} catch {
		return undefined;
	}
}

export function buildAuthorizationUrl(challenge: string, state: string): string {
	const authParams = new URLSearchParams({
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: SCOPES.join(" "),
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
		access_type: "offline",
		prompt: "consent",
	});
	return `${AUTH_URL}?${authParams.toString()}`;
}

export async function exchangeAuthorizationCode(
	code: string,
	verifier: string,
): Promise<OAuthCredentials> {
	const tokenResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			code,
			grant_type: "authorization_code",
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}).toString(),
	});

	if (!tokenResponse.ok) {
		const errText = await tokenResponse.text();
		throw new Error(`Token exchange failed (${tokenResponse.status}): ${errText.slice(0, 300)}`);
	}

	const tokenData = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in: number;
	};

	if (!tokenData.refresh_token) {
		throw new Error("No refresh token received. Re-run login and allow offline access.");
	}

	const [email, discoveredProject] = await Promise.all([
		getUserEmail(tokenData.access_token),
		loadCodeAssist(tokenData.access_token),
	]);

	return {
		refresh: tokenData.refresh_token,
		access: tokenData.access_token,
		expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
		projectId: discoveredProject || defaultProjectId(email || "antigravity-default"),
		email,
	};
}

export async function loginAntigravity(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { verifier, challenge } = generatePKCE();
	const state = base64Url(randomBytes(32));
	const { waitForCode, cleanup } = await startCallbackServer(state);

	try {
		callbacks.onAuth({
			url: buildAuthorizationUrl(challenge, state),
			instructions: "Complete sign-in in your browser, or paste the final callback URL below.",
		});

		const { code, state: returnedState } = await acquireAuthCode(state, {
			waitForCode,
			callbacks,
		});
		if (returnedState !== state) throw new Error("OAuth state mismatch");

		return await exchangeAuthorizationCode(code, verifier);
	} finally {
		cleanup();
	}
}

export async function refreshAntigravityToken(
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			refresh_token: String(credentials.refresh),
			grant_type: "refresh_token",
		}).toString(),
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(
			`Antigravity token refresh failed (${response.status}): ${errText.slice(0, 300)}`,
		);
	}

	const data = (await response.json()) as {
		access_token: string;
		expires_in: number;
		refresh_token?: string;
	};

	const existingProjectId =
		typeof credentials.projectId === "string" ? credentials.projectId : undefined;
	const discoveredProject = existingProjectId ? undefined : await loadCodeAssist(data.access_token);
	const email = typeof credentials.email === "string" ? credentials.email : undefined;

	return {
		...credentials,
		refresh: data.refresh_token || credentials.refresh,
		access: data.access_token,
		expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
		projectId:
			existingProjectId || discoveredProject || defaultProjectId(email || "antigravity-default"),
	};
}

export function getAntigravityApiKey(credentials: OAuthCredentials): string {
	const email = typeof credentials.email === "string" ? credentials.email : undefined;
	const projectId =
		(typeof credentials.projectId === "string" && credentials.projectId) ||
		defaultProjectId(email || "antigravity-default");
	return JSON.stringify({
		token: credentials.access,
		projectId,
	});
}
