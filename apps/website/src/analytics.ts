import { createWebsiteAnalytics, type MarketingConsentAdapter } from "@thinkrail/website-analytics";

declare global {
	interface Window {
		Cookiebot?: {
			hasResponse?: boolean;
			consent?: {
				marketing?: boolean;
			};
		};
	}
}

const consentEvents = [
	"CookiebotOnConsentReady",
	"CookiebotOnAccept",
	"CookiebotOnDecline",
] as const;

const marketingConsent: MarketingConsentAdapter = {
	current() {
		const cookiebot = window.Cookiebot;
		if (cookiebot?.hasResponse !== true) return undefined;
		return cookiebot.consent?.marketing === true;
	},
	subscribe(listener) {
		for (const event of consentEvents) window.addEventListener(event, listener);
		return () => {
			for (const event of consentEvents) window.removeEventListener(event, listener);
		};
	},
};

const websiteAnalytics = createWebsiteAnalytics({
	productionHostname: "thinkrail.ai",
	marketingConsent,
});

export const analyticsConfig = websiteAnalytics.configurationForHostname;
export const initAnalytics = websiteAnalytics.init;
export const captureAnalytics = websiteAnalytics.capture;
