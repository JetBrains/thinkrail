const productionHostname = "vibecoding.thinkrail.ai";
const containerId = "GTM-WDW2DZW4";
const gtmOrigin = "https://www.googletagmanager.com";

export type MarketingAnalyticsConfig = {
	containerId: string;
	scriptUrl: string;
};

export function marketingAnalyticsConfig(hostname: string): MarketingAnalyticsConfig | undefined {
	if (hostname !== productionHostname) return undefined;
	return {
		containerId,
		scriptUrl: `${gtmOrigin}/gtm.js?id=${containerId}`,
	};
}

export function initMarketingAnalytics() {
	if (typeof window === "undefined") return;
	const config = marketingAnalyticsConfig(window.location.hostname);
	if (!config) return;
	if (document.querySelector(`script[data-gtm-container="${config.containerId}"]`)) return;

	const analyticsWindow = window as Window & { dataLayer?: Array<Record<string, unknown>> };
	analyticsWindow.dataLayer ??= [];
	analyticsWindow.dataLayer.push({
		"gtm.start": Date.now(),
		event: "gtm.js",
	});

	const script = document.createElement("script");
	script.async = true;
	script.src = config.scriptUrl;
	script.dataset.gtmContainer = config.containerId;
	document.head.append(script);
}
