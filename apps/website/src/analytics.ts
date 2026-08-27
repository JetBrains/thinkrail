import { createWebsiteAnalytics } from "@thinkrail/website-analytics";

const websiteAnalytics = createWebsiteAnalytics({ productionHostname: "thinkrail.ai" });

export const analyticsConfig = websiteAnalytics.configurationForHostname;
export const initAnalytics = websiteAnalytics.init;
