import { createWebsiteAnalytics } from "@thinkrail/website-analytics";

const websiteAnalytics = createWebsiteAnalytics({
	productionHostname: "vibecoding.thinkrail.ai",
});

export const marketingAnalyticsConfig = websiteAnalytics.configurationForHostname;
export const initMarketingAnalytics = websiteAnalytics.init;
