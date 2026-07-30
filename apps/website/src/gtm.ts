// Google Tag Manager — progressive enhancement, production-only.
//
// Same shape as src/analytics.ts, for the same reasons: no npm dep, and we do NOT paste Google's
// minified snippet — Biome lints JS inside <script> tags and the snippet trips it
// (`noCommaOperator`, `noAssignInExpressions`), which would force a forbidden `biome-ignore`.
// This loader is behavior-equivalent to the snippet: push the `gtm.start` event onto `dataLayer`,
// then inject `gtm.js` async. No <noscript> iframe (decision in TASK-gtm-website): it is static
// HTML that can't be hostname-gated, and JS-disabled tracking isn't worth loosening the
// production-only gate.
//
// The hostname gate keeps GTM strictly on the public website: localhost, `vite dev`, `preview`,
// and the `jetbrains.github.io` apex load nothing — and apps/website never ships in user
// instances of the app anyway. See apps/website/SPEC.md.

const PROD_HOST = "thinkrail.ai";
const CONTAINER_ID = "GTM-WDW2DZW4"; // public by design — visible in any page that embeds GTM

declare global {
	interface Window {
		dataLayer?: Record<string, unknown>[];
	}
}

// Pure + side-effect-free so the production gate and the script URL are unit-testable without a
// browser. Returns null on any non-production host so nothing loads there.
export function gtmConfig(hostname: string): { id: string; src: string } | null {
	if (hostname !== PROD_HOST) return null;
	return {
		id: CONTAINER_ID,
		src: `https://www.googletagmanager.com/gtm.js?id=${CONTAINER_ID}`,
	};
}

export function initGtm(): void {
	const settings = gtmConfig(window.location.hostname);
	if (settings === null) return;

	window.dataLayer = window.dataLayer ?? [];
	window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });

	const script = document.createElement("script");
	script.src = settings.src;
	script.async = true;
	document.head.appendChild(script);
}
