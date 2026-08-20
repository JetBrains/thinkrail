// <script> tags and the snippet trips it, which would force a forbidden `biome-ignore`. array.js

const PROD_HOST = "thinkrail.ai";
const PROXY_HOST = "https://p.thinkrail.ai";
const UI_HOST = "https://eu.posthog.com";
const PROJECT_KEY = "phc_AFJBcKraEUrfpTrSSMjBGXMHTusYudtFfxWqdevchy8X";

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

export function analyticsConfig(hostname: string): AnalyticsInit | null {
	if (hostname !== PROD_HOST) return null;
	return {
		key: PROJECT_KEY,
		config: {
			api_host: PROXY_HOST,
			ui_host: UI_HOST,
			defaults: "2026-05-30",
			person_profiles: "identified_only",
			cookieless_mode: "always",
			respect_dnt: true,
			disable_session_recording: true,
		},
	};
}

export function initAnalytics(): void {
	const settings = analyticsConfig(window.location.hostname);
	if (settings === null) return;

	const script = document.createElement("script");
	script.src = `${PROXY_HOST}/static/array.js`;
	script.async = true;
	script.crossOrigin = "anonymous";
	script.addEventListener("load", () => {
		window.posthog?.init(settings.key, settings.config);
	});
	document.head.appendChild(script);
}
