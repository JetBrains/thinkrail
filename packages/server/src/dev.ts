import type { Provider } from "@earendil-works/pi-ai";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/oauth";
import { resolveShellEnv } from "@thinkrail/shared/shellEnv";
import { configurePiRuntimeGenerationInitializer } from "./agent";
import { initializeJbcentralRuntime } from "./auth";
import { bootHost } from "./host";

resolveShellEnv();

if (process.env.THINKRAIL_E2E_FAKE_OAUTH === "1") {
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
	configurePiRuntimeGenerationInitializer((runtime) => {
		runtime.registerProvider("e2e-oauth", { oauth: fakeOauth });
		runtime.registerNativeProvider(fakeApiKeyProvider);
	});
}

await initializeJbcentralRuntime();

const host = process.env.THINKRAIL_HOST ?? "localhost";
const staticDir = process.env.THINKRAIL_STATIC_DIR;
const envPort = process.env.THINKRAIL_PORT;

const { port } = await bootHost({
	port: envPort ? Number(envPort) : 24242,
	host,
	portMode: envPort ? "exact" : "free",
	...(staticDir ? { staticDir } : {}),
	analytics: { channel: "dev", build: "source" },
});
console.log(`thinkrail host: http://${host}:${port}`);
