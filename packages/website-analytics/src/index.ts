const postHogProjectKey = "phc_AFJBcKraEUrfpTrSSMjBGXMHTusYudtFfxWqdevchy8X";
const postHogProxyHost = "https://p.thinkrail.ai";
const postHogUiHost = "https://eu.posthog.com";
const gtmContainerId = "GTM-WDW2DZW4";

export type PostHogOptions = {
	api_host: string;
	ui_host: string;
	defaults: string;
	person_profiles: "identified_only";
	cookieless_mode: "always";
	respect_dnt: true;
	disable_session_recording: true;
};

export type WebsiteAnalyticsConfiguration = {
	postHog: {
		projectKey: string;
		scriptUrl: string;
		options: PostHogOptions;
	};
	gtm: {
		containerId: string;
		scriptUrl: string;
	};
};

export type WebsiteAnalytics = {
	configurationForHostname(hostname: string): WebsiteAnalyticsConfiguration | undefined;
	init(): void;
};

export type WebsiteAnalyticsOptions = {
	productionHostname: string;
};

interface PostHogClient {
	init(projectKey: string, options: PostHogOptions): void;
}

declare global {
	interface Window {
		posthog?: PostHogClient;
		dataLayer?: Array<Record<string, unknown>>;
	}
}

const sharedConfiguration: WebsiteAnalyticsConfiguration = {
	postHog: {
		projectKey: postHogProjectKey,
		scriptUrl: `${postHogProxyHost}/static/array.js`,
		options: {
			api_host: postHogProxyHost,
			ui_host: postHogUiHost,
			defaults: "2026-05-30",
			person_profiles: "identified_only",
			cookieless_mode: "always",
			respect_dnt: true,
			disable_session_recording: true,
		},
	},
	gtm: {
		containerId: gtmContainerId,
		scriptUrl: `https://www.googletagmanager.com/gtm.js?id=${gtmContainerId}`,
	},
};

function initPostHog(configuration: WebsiteAnalyticsConfiguration["postHog"]): void {
	if (document.querySelector(`script[data-posthog-project="${configuration.projectKey}"]`)) return;

	const script = document.createElement("script");
	script.src = configuration.scriptUrl;
	script.async = true;
	script.crossOrigin = "anonymous";
	script.dataset.posthogProject = configuration.projectKey;
	script.addEventListener("load", () => {
		window.posthog?.init(configuration.projectKey, configuration.options);
	});
	document.head.appendChild(script);
}

function initGtm(configuration: WebsiteAnalyticsConfiguration["gtm"]): void {
	if (document.querySelector(`script[data-gtm-container="${configuration.containerId}"]`)) return;

	window.dataLayer ??= [];
	window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });

	const script = document.createElement("script");
	script.src = configuration.scriptUrl;
	script.async = true;
	script.dataset.gtmContainer = configuration.containerId;
	document.head.appendChild(script);
}

export function createWebsiteAnalytics({
	productionHostname,
}: WebsiteAnalyticsOptions): WebsiteAnalytics {
	function configurationForHostname(hostname: string): WebsiteAnalyticsConfiguration | undefined {
		return hostname === productionHostname ? sharedConfiguration : undefined;
	}

	function init(): void {
		if (typeof window === "undefined") return;
		const configuration = configurationForHostname(window.location.hostname);
		if (!configuration) return;
		initPostHog(configuration.postHog);
		initGtm(configuration.gtm);
	}

	return { configurationForHostname, init };
}
