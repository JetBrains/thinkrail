import {
	createWebsiteAnalytics,
	type MarketingConsentAdapter,
	type WebsiteAnalytics,
} from "@thinkrail/website-analytics";

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

export const websitePostHogEnabled = false;

export function createSiteAnalytics(postHogEnabled: boolean): WebsiteAnalytics {
	return createWebsiteAnalytics({
		productionHostname: "thinkrail.ai",
		postHogProjectKey: import.meta.env.PUBLIC_POSTHOG_PROJECT_KEY ?? "",
		postHogEnabled,
		marketingConsent,
	});
}

const websiteAnalytics = createSiteAnalytics(websitePostHogEnabled);

export const analyticsConfig = websiteAnalytics.configurationForHostname;
export const currentMarketingConsent = marketingConsent.current;
export const initAnalytics = websiteAnalytics.init;
export const captureAnalytics = websiteAnalytics.capture;
export const currentJourneyId = websiteAnalytics.currentJourneyId;
export const subscribeJourney = websiteAnalytics.subscribeJourney;
