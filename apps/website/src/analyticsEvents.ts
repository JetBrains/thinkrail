import type {
	WebsiteCtaLocation,
	WebsiteDownloadStartedProperties,
	WebsiteGithubClickedProperties,
	WebsiteGithubLocation,
	WebsiteInstallCommandCopiedProperties,
	WebsiteInstallCtaClickedProperties,
	WebsiteInstallLinkShareClickedProperties,
} from "@thinkrail/website-analytics";
import { captureAnalytics } from "./analytics";
import {
	initAttributionRecording,
	recordCurrentAttributionTouch,
	recordCurrentDownloadBridge,
} from "./attribution";
import { installCommands } from "./installCommands";

const maxContentKeyLength = 105;
const githubRepositoryUrl = "https://github.com/JetBrains/thinkrail";

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
type AttributionRecorder = () => void;
type DownloadBridgeRecorder = () => string | undefined;

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

const githubLocationSelectors = [
	["blog_post", ".blog-post"],
	["final_cta", "#cta"],
	["quick_start", "#quick-start"],
	["install_section", "#install"],
	["hero", "#readme"],
	["hero", "#top"],
	["header", "header"],
	["footer", "#contributing"],
	["footer", "footer"],
	["terminal", ".terminal"],
	["mock_hint", "#mock-tooltip"],
] as const satisfies ReadonlyArray<readonly [WebsiteGithubLocation, string]>;

const installCommandShells = new Map<string, WebsiteInstallCommandCopiedProperties["shell"]>([
	[installCommands.macos, "sh"],
	[installCommands.windows.powershell, "powershell"],
	[installCommands.windows.cmd, "cmd"],
]);

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

function hasAttributeAccess(value: unknown): value is AttributeElement {
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

export function contentKeyForPathname(pathname: string): string | undefined {
	if (pathname === "/") return "landing";

	const path = pathname.replace(/^\//, "").replace(/\/$/, "");
	if (path === "blog") return "blog/index";
	if (path.length > maxContentKeyLength || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(path)) {
		return undefined;
	}
	return path;
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

export function githubLocationForElement(element: ClosestElement): WebsiteGithubLocation {
	for (const [location, selector] of githubLocationSelectors) {
		if (element.closest(selector) !== null) return location;
	}
	return "other";
}

export function githubTargetForUrl(
	url: string,
): WebsiteGithubClickedProperties["target"] | undefined {
	if (!url.startsWith(githubRepositoryUrl) || desktopArtifactForUrl(url) !== undefined) {
		return undefined;
	}
	const rest = url.slice(githubRepositoryUrl.length);
	if (rest === "" || rest === "/" || rest.startsWith("#") || rest.startsWith("?")) return "repo";
	if (!rest.startsWith("/")) return undefined;
	return /^\/releases(?:[/?#]|$)/.test(rest) ? "releases" : "other";
}

export function githubClickedEvent(
	contentKey: string,
	anchor: ClosestElement,
	url: string,
): { event: "github_clicked"; properties: WebsiteGithubClickedProperties } | undefined {
	const target = githubTargetForUrl(url);
	if (target === undefined) return undefined;
	return {
		event: "github_clicked",
		properties: {
			content_key: contentKey,
			cta_location: githubLocationForElement(anchor),
			target,
		},
	};
}

export function installCommandCopiedEvent(
	contentKey: string,
	button: AttributeElement,
):
	| { event: "install_command_copied"; properties: WebsiteInstallCommandCopiedProperties }
	| undefined {
	const shell = installCommandShells.get(button.getAttribute("data-copy") ?? "");
	const ctaLocation = ctaLocationForElement(button);
	if (shell === undefined || (ctaLocation !== "hero" && ctaLocation !== "install_section")) {
		return undefined;
	}
	return {
		event: "install_command_copied",
		properties: { content_key: contentKey, cta_location: ctaLocation, shell },
	};
}

export function installLinkShareClickedEvent(
	contentKey: string,
	button: ClosestElement,
):
	| { event: "install_link_share_clicked"; properties: WebsiteInstallLinkShareClickedProperties }
	| undefined {
	const ctaLocation = ctaLocationForElement(button);
	if (ctaLocation !== "hero" && ctaLocation !== "quick_start") return undefined;
	return {
		event: "install_link_share_clicked",
		properties: { content_key: contentKey, cta_location: ctaLocation },
	};
}

export function cliDisclosureLocation(
	disclosure: CliDisclosure,
): "hero" | "install_section" | undefined {
	if (disclosure.matches("details.cli-disclosure")) return "hero";
	if (disclosure.matches("details.install-reference")) return "install_section";
	return undefined;
}

export function cliDisclosureOpenedEvent(
	contentKey: string,
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
	contentKey: string,
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

function closestWithAttributes(target: unknown, selector: string): AttributeElement | undefined {
	if (!hasClosest(target)) return undefined;
	const element = target.closest(selector);
	return hasAttributeAccess(element) ? element : undefined;
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

	initializeAttribution();
	capture("content_viewed", { content_key: contentKey });

	const captureDesktopDownload = (anchor: AttributeElement, url: string): boolean => {
		const ctaLocation = ctaLocationForElement(anchor);
		if (ctaLocation === undefined) return false;
		const events = desktopClickEvents(contentKey, ctaLocation, url);
		if (events === undefined) return false;
		recordAttribution();
		capture("install_cta_clicked", events[0].properties);
		recordAttribution();
		const bridgeId = recordDownloadBridge();
		capture("download_started", {
			...events[1].properties,
			...(bridgeId === undefined ? {} : { bridge_id: bridgeId }),
		});
		return true;
	};

	const captureControlClick = (target: unknown): void => {
		const copyButton = closestWithAttributes(target, "[data-copy]");
		const copied = copyButton && installCommandCopiedEvent(contentKey, copyButton);
		if (copied) {
			recordAttribution();
			capture(copied.event, copied.properties);
			return;
		}
		const shareButton = closestWithAttributes(target, "[data-share-install-link]");
		const shared = shareButton && installLinkShareClickedEvent(contentKey, shareButton);
		if (shared) {
			recordAttribution();
			capture(shared.event, shared.properties);
		}
	};

	const captureClick = (event: Event): void => {
		const button = "button" in event ? event.button : undefined;
		if ((event.type === "click" && button !== 0) || (event.type === "auxclick" && button !== 1)) {
			return;
		}
		const anchor = closestWithAttributes(event.target, "a[href]");
		if (anchor === undefined) {
			if (event.type === "click") captureControlClick(event.target);
			return;
		}
		const url = anchor.getAttribute("href");
		if (url === null || captureDesktopDownload(anchor, url)) return;
		const github = githubClickedEvent(contentKey, anchor, url);
		if (github === undefined) return;
		recordAttribution();
		capture(github.event, github.properties);
	};

	analyticsDocument.addEventListener("click", captureClick);
	analyticsDocument.addEventListener("auxclick", captureClick);
	analyticsDocument.addEventListener(
		"toggle",
		(event) => {
			if (!isCliDisclosure(event.target)) return;
			const opened = cliDisclosureOpenedEvent(contentKey, event.target);
			if (opened !== undefined) {
				recordAttribution();
				capture(opened.event, opened.properties);
			}
		},
		true,
	);
}
