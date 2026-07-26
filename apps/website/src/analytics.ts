// PostHog analytics — progressive enhancement, production-only, cookieless.
//
// No npm dep (module boundary): we inject PostHog's `array.js` at runtime instead of importing
// `posthog-js`. We also do NOT paste PostHog's minified bootstrap snippet — Biome lints JS inside
// <script> tags and the snippet trips it, which would force a forbidden `biome-ignore`. array.js
// self-assigns `window.posthog` on load (its stub-queue replay is guarded: `stub && replay(...)`),
// so calling `init()` in the load handler is safe without the stub — we never call posthog methods
// before load, so the queue is unnecessary.

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

export function initAnalytics(): void {
	// Production only — never from localhost, `vite dev`, `preview`, or the GitHub Pages apex.
	if (window.location.hostname !== PROD_HOST) return;

	const script = document.createElement("script");
	script.src = `${ASSET_HOST}/static/array.js`;
	script.async = true;
	script.crossOrigin = "anonymous";
	script.addEventListener("load", () => {
		window.posthog?.init(PROJECT_KEY, {
			api_host: API_HOST,
			defaults: "2026-05-30",
			person_profiles: "identified_only",
			persistence: "localStorage", // cookieless: first-party id in localStorage, no tracking cookie
			respect_dnt: true,
			disable_session_recording: true,
		});
	});
	document.head.appendChild(script);
}
