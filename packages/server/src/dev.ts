// Dev/e2e entry: boot the host from env. The polished `thinkrail` bin lives in apps/cli.
import { bootHost } from "./host";

// e2e-only: register a deterministic fake pi OAuth provider so the in-app login flow (select → open URL /
// paste code → success) is drivable end-to-end without a real provider or browser. Gated by
// THINKRAIL_E2E_FAKE_OAUTH; this file is the dev/e2e entry and never ships (apps/cli is the prod bin).
if (process.env.THINKRAIL_E2E_FAKE_OAUTH === "1") {
	const { registerOAuthProvider } = await import("@earendil-works/pi-ai/oauth");
	const { ModelRegistry } = await import("@earendil-works/pi-coding-agent");
	const fakeProvider = {
		id: "e2e-oauth",
		name: "E2E Test Provider",
		usesCallbackServer: false,
		async login(callbacks: {
			onSelect: (p: {
				message: string;
				options: { id: string; label: string }[];
			}) => Promise<string | undefined>;
			onAuth: (i: { url: string }) => void;
			onManualCodeInput?: () => Promise<string>;
			onProgress?: (m: string) => void;
		}) {
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
		async refreshToken(credentials: unknown) {
			return credentials;
		},
		getApiKey(credentials: { access?: unknown }) {
			return String(credentials.access);
		},
	};
	// ModelRegistry.refresh() calls resetOAuthProviders() (wiping external registrations), and the host reads
	// provider.status (→ refresh) on every check — so re-register the fake after each refresh. Patching the
	// prototype here keeps production code untouched; safe because dev.ts is e2e/dev-only.
	type Refreshable = { refresh: () => void };
	const proto = ModelRegistry.prototype as unknown as Refreshable;
	const originalRefresh = proto.refresh;
	proto.refresh = function reRegisterFakeOAuth(this: Refreshable) {
		originalRefresh.call(this);
		registerOAuthProvider(fakeProvider as never);
	};
	registerOAuthProvider(fakeProvider as never);
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
