const postHogProjectKey = "phc_AFJBcKraEUrfpTrSSMjBGXMHTusYudtFfxWqdevchy8X";
const postHogProxyHost = "https://p.thinkrail.ai";
const postHogUiHost = "https://eu.posthog.com";
const gtmContainerId = "GTM-WDW2DZW4";
const journeyStorageKey = "thinkrail_journey_id";
const journeyProperty = "journey_id";
const captureQueueLimit = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export type MarketingConsentAdapter = {
	current(): boolean | undefined;
	subscribe(listener: () => void): () => void;
};

export type WebsiteContentViewedProperties = {
	content_key: string;
};

export type WebsiteInstallCtaClickedProperties = {
	content_key: string;
	cta_location: "hero" | "install_section" | "quick_start" | "final_cta";
	install_method: "desktop" | "cli";
};

export type WebsiteDownloadStartedProperties = {
	content_key: string;
	cta_location: "hero" | "install_section" | "quick_start" | "final_cta";
	platform: "macos" | "windows" | "linux";
	architecture: "arm64" | "x64";
	artifact: "dmg" | "zip" | "tar.gz";
	bridge_id: string;
};

export type WebsiteAnalyticsEventProperties = {
	content_viewed: WebsiteContentViewedProperties;
	install_cta_clicked: WebsiteInstallCtaClickedProperties;
	download_started: WebsiteDownloadStartedProperties;
};

export type WebsiteAnalyticsEventName = keyof WebsiteAnalyticsEventProperties;

export type WebsiteAnalytics = {
	configurationForHostname(hostname: string): WebsiteAnalyticsConfiguration | undefined;
	init(): void;
	capture<EventName extends WebsiteAnalyticsEventName>(
		event: EventName,
		properties: WebsiteAnalyticsEventProperties[EventName],
	): void;
};

export type WebsiteAnalyticsOptions = {
	productionHostname: string;
	marketingConsent: MarketingConsentAdapter;
};

interface PostHogClient {
	init(projectKey: string, options: PostHogOptions): void;
	capture(event: WebsiteAnalyticsEventName, properties: Record<string, unknown>): void;
	register(properties: Record<string, unknown>): void;
	unregister(property: string): void;
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

function initPostHog(
	configuration: WebsiteAnalyticsConfiguration["postHog"],
	onLoad: () => void,
	onError: () => void,
): void {
	if (document.querySelector(`script[data-posthog-project="${configuration.projectKey}"]`)) return;

	const script = document.createElement("script");
	script.src = configuration.scriptUrl;
	script.async = true;
	script.crossOrigin = "anonymous";
	script.dataset.posthogProject = configuration.projectKey;
	script.addEventListener("load", onLoad);
	script.addEventListener("error", onError);
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

function storedOrNewJourneyId(): string | undefined {
	try {
		const storage = window.localStorage;
		const existing = storage.getItem(journeyStorageKey);
		if (existing !== null && uuidPattern.test(existing)) return existing;
		const created = window.crypto.randomUUID();
		if (!uuidPattern.test(created)) return undefined;
		storage.setItem(journeyStorageKey, created);
		return created;
	} catch {
		return undefined;
	}
}

function removeStoredJourneyId(): void {
	try {
		window.localStorage.removeItem(journeyStorageKey);
	} catch {}
}

export function createWebsiteAnalytics({
	productionHostname,
	marketingConsent,
}: WebsiteAnalyticsOptions): WebsiteAnalytics {
	let initialized = false;
	let consentGranted: boolean | undefined;
	let journeyId: string | undefined;
	let postHogReady = false;
	let postHogFailed = false;
	const captureQueue: Array<{
		event: WebsiteAnalyticsEventName;
		properties: Record<string, unknown>;
	}> = [];

	function configurationForHostname(hostname: string): WebsiteAnalyticsConfiguration | undefined {
		return hostname === productionHostname ? sharedConfiguration : undefined;
	}

	function enabledInCurrentWindow(): boolean {
		return (
			typeof window !== "undefined" &&
			configurationForHostname(window.location.hostname) !== undefined
		);
	}

	function registerJourney(): void {
		if (!postHogReady || journeyId === undefined) return;
		try {
			window.posthog?.register({ [journeyProperty]: journeyId });
		} catch {}
	}

	function unregisterJourney(): void {
		if (!postHogReady) return;
		try {
			window.posthog?.unregister(journeyProperty);
		} catch {}
	}

	function setConsent(granted: boolean | undefined): void {
		if (granted === undefined || granted === consentGranted) return;
		consentGranted = granted;
		if (granted) {
			journeyId = storedOrNewJourneyId();
			registerJourney();
			return;
		}

		journeyId = undefined;
		removeStoredJourneyId();
		unregisterJourney();
		for (const queued of captureQueue) delete queued.properties[journeyProperty];
	}

	function refreshConsent(): void {
		let granted: boolean | undefined;
		try {
			granted = marketingConsent.current();
		} catch {}
		setConsent(granted);
	}

	function sendQueuedCaptures(): void {
		if (!postHogReady || window.posthog === undefined) return;
		while (captureQueue.length > 0) {
			const queued = captureQueue.shift();
			if (queued === undefined) return;
			try {
				window.posthog.capture(queued.event, queued.properties);
			} catch {}
		}
	}

	function failPostHog(): void {
		postHogFailed = true;
		captureQueue.length = 0;
	}

	function onPostHogLoad(configuration: WebsiteAnalyticsConfiguration["postHog"]): void {
		if (postHogFailed) return;
		const posthog = window.posthog;
		if (posthog === undefined) {
			failPostHog();
			return;
		}
		try {
			posthog.init(configuration.projectKey, configuration.options);
		} catch {
			failPostHog();
			return;
		}
		postHogReady = true;
		sendQueuedCaptures();
		registerJourney();
	}

	function init(): void {
		if (!enabledInCurrentWindow() || initialized) return;
		initialized = true;
		const configuration = sharedConfiguration;
		try {
			marketingConsent.subscribe(refreshConsent);
			refreshConsent();
		} catch {
			setConsent(false);
		}
		initPostHog(configuration.postHog, () => onPostHogLoad(configuration.postHog), failPostHog);
		initGtm(configuration.gtm);
	}

	function capture<EventName extends WebsiteAnalyticsEventName>(
		event: EventName,
		properties: WebsiteAnalyticsEventProperties[EventName],
	): void {
		if (!enabledInCurrentWindow()) return;
		const enrichedProperties: Record<string, unknown> = { ...properties };
		if (consentGranted === true && journeyId !== undefined) {
			enrichedProperties[journeyProperty] = journeyId;
		}
		if (postHogFailed) return;
		if (!postHogReady || window.posthog === undefined) {
			if (captureQueue.length === captureQueueLimit) captureQueue.shift();
			captureQueue.push({ event, properties: enrichedProperties });
			return;
		}
		try {
			window.posthog.capture(event, enrichedProperties);
		} catch {}
	}

	return { configurationForHostname, init, capture };
}
