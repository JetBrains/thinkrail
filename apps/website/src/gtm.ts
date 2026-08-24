const PROD_HOST = "thinkrail.ai";
const CONTAINER_ID = "GTM-WDW2DZW4";

declare global {
	interface Window {
		dataLayer?: Record<string, unknown>[];
	}
}

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
