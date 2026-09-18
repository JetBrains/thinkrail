import type {
	WebsiteDownloadStartedProperties,
	WebsiteInstallCtaClickedProperties,
} from "@thinkrail/website-analytics";
import { captureAnalytics } from "./analytics";
import {
	initAttributionRecording,
	recordCurrentAttributionTouch,
	recordCurrentDownloadBridge,
} from "./attribution/recording";

export const contentRoutes = {
	"/": "landing",
	"/blog/": "blog/index",
	"/blog/introducing-thinkrail/": "blog/introducing-thinkrail",
	"/blog/thinkrail-workspaces/": "blog/thinkrail-workspaces",
	"/blog/thinkrail-sdd/": "blog/thinkrail-sdd",
	"/vibecoding/": "vibecoding",
	"/agentic-development/": "agentic-development",
} as const;

export type WebsiteContentKey = (typeof contentRoutes)[keyof typeof contentRoutes];
export type WebsiteCtaLocation = WebsiteInstallCtaClickedProperties["cta_location"];

type DesktopArtifact = Pick<
	WebsiteDownloadStartedProperties,
	"platform" | "architecture" | "artifact"
>;

type ClosestElement = {
	closest(selector: string): unknown;
};

type AttributeElement = ClosestElement & {
	getAttribute(name: string): string | null;
};

type CliDisclosure = {
	open: boolean;
	matches(selector: string): boolean;
};

type AnalyticsCapture = typeof captureAnalytics;
type AttributionRecorder = (contentKey: WebsiteContentKey) => void;
type DownloadBridgeRecorder = (contentKey: WebsiteContentKey) => string | undefined;

type AnalyticsDocument = object & {
	addEventListener(type: string, listener: EventListener, options?: boolean): void;
};

export type DesktopClickEvents = readonly [
	{
		event: "install_cta_clicked";
		properties: WebsiteInstallCtaClickedProperties;
	},
	{
		event: "download_started";
		properties: WebsiteDownloadStartedProperties;
	},
];

const stableDesktopArtifacts = {
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-arm64.dmg":
		{
			platform: "macos",
			architecture: "arm64",
			artifact: "dmg",
		},
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-windows-x64.zip":
		{
			platform: "windows",
			architecture: "x64",
			artifact: "zip",
		},
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-x64.tar.gz":
		{
			platform: "linux",
			architecture: "x64",
			artifact: "tar.gz",
		},
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-arm64.tar.gz":
		{
			platform: "linux",
			architecture: "arm64",
			artifact: "tar.gz",
		},
} as const satisfies Record<string, DesktopArtifact>;

const locationSelectors = [
	["blog_post", ".blog-post"],
	["final_cta", "#cta"],
	["quick_start", "#quick-start"],
	["install_section", "#install"],
	["hero", "#readme"],
] as const satisfies ReadonlyArray<readonly [WebsiteCtaLocation, string]>;

const initializedDocuments = new WeakSet<object>();

function hasOwn<Value extends object>(value: Value, key: PropertyKey): key is keyof Value {
	return Object.hasOwn(value, key);
}

function hasClosest(value: unknown): value is ClosestElement {
	return (
		typeof value === "object" &&
		value !== null &&
		"closest" in value &&
		typeof value.closest === "function"
	);
}

function hasAnchorAttributes(value: unknown): value is AttributeElement {
	return hasClosest(value) && "getAttribute" in value && typeof value.getAttribute === "function";
}

function isCliDisclosure(value: unknown): value is CliDisclosure {
	return (
		typeof value === "object" &&
		value !== null &&
		"open" in value &&
		typeof value.open === "boolean" &&
		"matches" in value &&
		typeof value.matches === "function"
	);
}

export function contentKeyForPathname(pathname: string): WebsiteContentKey | undefined {
	return hasOwn(contentRoutes, pathname) ? contentRoutes[pathname] : undefined;
}

export function desktopArtifactForUrl(url: string): DesktopArtifact | undefined {
	return hasOwn(stableDesktopArtifacts, url) ? stableDesktopArtifacts[url] : undefined;
}

export function ctaLocationForElement(element: ClosestElement): WebsiteCtaLocation | undefined {
	for (const [location, selector] of locationSelectors) {
		if (element.closest(selector) !== null) return location;
	}
	return undefined;
}

export function cliDisclosureLocation(
	disclosure: CliDisclosure,
): "hero" | "install_section" | undefined {
	if (disclosure.matches("details.cli-disclosure")) return "hero";
	if (disclosure.matches("details.install-reference")) return "install_section";
	return undefined;
}

export function cliDisclosureOpenedEvent(
	contentKey: WebsiteContentKey,
	disclosure: CliDisclosure,
): DesktopClickEvents[0] | undefined {
	if (!disclosure.open) return undefined;
	const ctaLocation = cliDisclosureLocation(disclosure);
	if (ctaLocation === undefined) return undefined;
	return {
		event: "install_cta_clicked",
		properties: {
			content_key: contentKey,
			cta_location: ctaLocation,
			install_method: "cli",
		},
	};
}

export function desktopClickEvents(
	contentKey: WebsiteContentKey,
	ctaLocation: WebsiteCtaLocation,
	url: string,
): DesktopClickEvents | undefined {
	const artifact = desktopArtifactForUrl(url);
	if (artifact === undefined) return undefined;
	return [
		{
			event: "install_cta_clicked",
			properties: {
				content_key: contentKey,
				cta_location: ctaLocation,
				install_method: "desktop",
			},
		},
		{
			event: "download_started",
			properties: {
				content_key: contentKey,
				cta_location: ctaLocation,
				...artifact,
			},
		},
	];
}

function closestAnchor(target: unknown): AttributeElement | undefined {
	if (!hasClosest(target)) return undefined;
	const anchor = target.closest("a[href]");
	return hasAnchorAttributes(anchor) ? anchor : undefined;
}

export function initAnalyticsEvents(
	analyticsDocument: AnalyticsDocument = document,
	pathname = window.location.pathname,
	capture: AnalyticsCapture = captureAnalytics,
	initializeAttribution: AttributionRecorder = initAttributionRecording,
	recordAttribution: AttributionRecorder = recordCurrentAttributionTouch,
	recordDownloadBridge: DownloadBridgeRecorder = recordCurrentDownloadBridge,
): void {
	if (initializedDocuments.has(analyticsDocument)) return;
	initializedDocuments.add(analyticsDocument);

	const contentKey = contentKeyForPathname(pathname);
	if (contentKey === undefined) return;

	initializeAttribution(contentKey);
	capture("content_viewed", { content_key: contentKey });

	const captureDesktopClick = (event: Event): void => {
		const button = "button" in event ? event.button : undefined;
		if ((event.type === "click" && button !== 0) || (event.type === "auxclick" && button !== 1)) {
			return;
		}
		const anchor = closestAnchor(event.target);
		if (anchor === undefined) return;
		const ctaLocation = ctaLocationForElement(anchor);
		const url = anchor.getAttribute("href");
		if (ctaLocation === undefined || url === null) return;
		const events = desktopClickEvents(contentKey, ctaLocation, url);
		if (events === undefined) return;
		recordAttribution(contentKey);
		capture("install_cta_clicked", events[0].properties);
		recordAttribution(contentKey);
		const bridgeId = recordDownloadBridge(contentKey);
		capture("download_started", {
			...events[1].properties,
			...(bridgeId === undefined ? {} : { bridge_id: bridgeId }),
		});
	};

	analyticsDocument.addEventListener("click", captureDesktopClick);
	analyticsDocument.addEventListener("auxclick", captureDesktopClick);
	analyticsDocument.addEventListener(
		"toggle",
		(event) => {
			if (!isCliDisclosure(event.target)) return;
			const opened = cliDisclosureOpenedEvent(contentKey, event.target);
			if (opened !== undefined) {
				recordAttribution(contentKey);
				capture(opened.event, opened.properties);
			}
		},
		true,
	);
}
