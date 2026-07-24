// Dev/e2e entry: boot the host from env. The polished `thinkrail` bin lives in apps/cli.
import type { Provider } from "@earendil-works/pi-ai";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/oauth";
import { bootHost } from "./host";

// e2e-only: register deterministic fake pi providers so the in-app login flows are drivable end-to-end
// without a real provider or browser — `e2e-oauth` (OAuth: select → open URL / paste code → success) and
// `e2e-apikey` (interactive API-key entry: one secret prompt → success, issue #97). Gated by
// THINKRAIL_E2E_FAKE_OAUTH; this file is the dev/e2e entry and never ships (apps/cli is the prod bin).
if (process.env.THINKRAIL_E2E_FAKE_OAUTH === "1") {
	const { getPiRuntime } = await import("./agent");
	const fakeOauth = {
		name: "E2E Test Provider",
		async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
			const choice = await callbacks.onSelect({
				message: "How do you want to sign in?",
				options: [
					{ id: "subscription", label: "Subscription" },
					{ id: "api", label: "API console" },
				],
			});
			if (!choice) throw new Error("Login cancelled");
			callbacks.onAuth({ url: "https://e2e.test/authorize?probe=1" });
			const code = (await callbacks.onManualCodeInput?.()) ?? "";
			callbacks.onProgress?.("Exchanging authorization code…");
			// Far-future expiry (no Date.now needed) so the stored credential never reads as expired.
			return {
				refresh: "e2e-refresh",
				access: `e2e-access-${choice}-${code}`,
				expires: 4102444800000,
			};
		},
		async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
			return credentials;
		},
		getApiKey(credentials: OAuthCredentials): string {
			return String(credentials.access);
		},
	};
	// An extension provider on the shared runtime: pi keeps extension registrations across
	// refresh()/reloadConfig() (they're a composed overlay), so no re-register hook is needed.
	(await getPiRuntime()).registerProvider("e2e-oauth", { oauth: fakeOauth });

	// The API-key fake must be a NATIVE provider (pi 0.81 full provider extensions): only `Provider.auth`
	// can express an interactive `apiKey.login` — the ProviderConfig path above takes a key *string*, not
	// a flow. `login` runs one secret prompt (multi-prompt providers differ only in prompt count — the
	// bridge parks each the same way); pi persists the returned credential to auth.json itself.
	const dummyStream = (): never => {
		throw new Error("e2e-apikey is a login fixture — it never streams");
	};
	const fakeApiKeyProvider: Provider = {
		id: "e2e-apikey",
		name: "E2E Key Provider",
		baseUrl: "http://e2e-apikey.test",
		auth: {
			apiKey: {
				name: "E2E Key Provider API key",
				async login(interaction) {
					const key = await interaction.prompt({
						type: "secret",
						message: "Enter your E2E Key Provider API key",
						placeholder: "e2e-...",
					});
					if (!key.trim()) throw new Error("API key must not be empty");
					return { type: "api_key", key: key.trim() };
				},
				async resolve({ credential }) {
					if (!credential?.key) return undefined;
					return { auth: { apiKey: credential.key }, source: "E2E API key" };
				},
			},
		},
		getModels: () => [
			{
				id: "e2e-key-model",
				name: "E2E Key Model",
				provider: "e2e-apikey",
				api: "openai-completions",
				baseUrl: "http://e2e-apikey.test",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
		stream: dummyStream,
		streamSimple: dummyStream,
	};
	(await getPiRuntime()).registerNativeProvider(fakeApiKeyProvider);
}

const host = process.env.THINKRAIL_HOST ?? "localhost";
const staticDir = process.env.THINKRAIL_STATIC_DIR;
// An explicit THINKRAIL_PORT is honored as-is (e2e pins it; the dev launcher pre-picks it so vite's
// proxy can match). With none set, pick a free port so a standalone host never collides with one running.
const envPort = process.env.THINKRAIL_PORT;

const { port } = await bootHost({
	port: envPort ? Number(envPort) : 24242,
	host,
	portMode: envPort ? "exact" : "free",
	...(staticDir ? { staticDir } : {}),
});
console.log(`thinkrail host: http://${host}:${port}`);
