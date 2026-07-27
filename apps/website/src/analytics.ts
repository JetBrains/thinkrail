// PostHog analytics — progressive enhancement, production-only, genuinely cookieless.
//
// No npm dep (module boundary): we inject PostHog's `array.js` at runtime instead of importing
// `posthog-js`. We also do NOT paste PostHog's minified bootstrap snippet — Biome lints JS inside
// <script> tags and the snippet trips it, which would force a forbidden `biome-ignore`. array.js
// self-assigns `window.posthog` on load (its stub-queue replay is guarded: `stub && replay(...)`),
// so calling `init()` in the load handler is safe without the stub.
//
// Privacy: `cookieless_mode: "always"` — PostHog stores NOTHING on the device (no cookie, no local
// or session storage); visitor identity is a privacy-preserving hash computed server-side from a
// daily-rotating salt + IP + host + user-agent. Nothing persistent lands in the browser, so no
// consent banner is required under GDPR/ePrivacy. REQUIRES "Cookieless server hash mode" enabled in
// the PostHog project settings (Project Settings → Web analytics), or events are dropped. See
// apps/website/SPEC.md.

const PROD_HOST = "thinkrail.ai";
const API_HOST = "https://eu.i.posthog.com";
const ASSET_HOST = "https://eu-assets.i.posthog.com";
const PROJECT_KEY = "phc_AFJBcKraEUrfpTrSSMjBGXMHTusYudtFfxWqdevchy8X"; // public/client-safe key

interface PostHogLike {
	init(key: string, config: Record<string, unknown>): void;
}

declare global {
	interface Window {
		posthog?: PostHogLike;
	}
}

export interface AnalyticsInit {
	key: string;
	config: Record<string, unknown>;
}

// Pure + side-effect-free so the production gate and the cookieless (no-storage) config are
// unit-testable without a browser. Returns null on any non-production host (localhost, `vite dev`,
// `preview`, the GitHub Pages apex) so nothing loads there.
export function analyticsConfig(hostname: string): AnalyticsInit | null {
	if (hostname !== PROD_HOST) return null;
	return {
		key: PROJECT_KEY,
		config: {
			api_host: API_HOST,
			defaults: "2026-05-30",
			person_profiles: "identified_only",
			cookieless_mode: "always", // no cookie / local / session storage — identity is a server-side hash
			respect_dnt: true,
			disable_session_recording: true,
		},
	};
}

export function initAnalytics(): void {
	const settings = analyticsConfig(window.location.hostname);
	if (settings === null) return;

	const script = document.createElement("script");
	script.src = `${ASSET_HOST}/static/array.js`;
	script.async = true;
	script.crossOrigin = "anonymous";
	script.addEventListener("load", () => {
		window.posthog?.init(settings.key, settings.config);
	});
	document.head.appendChild(script);
}
