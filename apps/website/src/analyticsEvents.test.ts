import { describe, expect, test } from "bun:test";
import type { WebsiteAnalyticsEventProperties } from "@thinkrail/website-analytics";
import {
	cliDisclosureOpenedEvent,
	contentKeyForPathname,
	contentRoutes,
	ctaLocationForElement,
	desktopArtifactForUrl,
	desktopClickEvents,
	initAnalyticsEvents,
	type WebsiteContentKey,
} from "./analyticsEvents";

const stableDesktopAliases = {
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
} as const;

type Capture = <EventName extends keyof WebsiteAnalyticsEventProperties>(
	event: EventName,
	properties: WebsiteAnalyticsEventProperties[EventName],
) => void;

type CapturedEvent = {
	event: keyof WebsiteAnalyticsEventProperties;
	properties: WebsiteAnalyticsEventProperties[keyof WebsiteAnalyticsEventProperties];
};

class FakeDocument {
	readonly listeners = new Map<string, EventListener[]>();

	addEventListener(type: string, listener: EventListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string, event: object): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener({ type, ...event } as Event);
		}
	}
}

function captureLog(): { capture: Capture; events: CapturedEvent[] } {
	const events: CapturedEvent[] = [];
	return {
		events,
		capture: ((event, properties) => events.push({ event, properties })) as Capture,
	};
}

function elementAt(selector: string) {
	return {
		closest(candidate: string) {
			return candidate === selector ? this : null;
		},
	};
}

function desktopAnchor(url: string, locationSelector: string) {
	return {
		closest(selector: string) {
			if (selector === "a[href]" || selector === locationSelector) return this;
			return null;
		},
		getAttribute(name: string) {
			return name === "href" ? url : null;
		},
	};
}

function disclosure(open: boolean, selector: string) {
	return {
		open,
		matches(candidate: string) {
			return candidate === selector;
		},
	};
}

describe("website content routes", () => {
	test("pins every static document to one closed content key", () => {
		expect(contentRoutes).toEqual({
			"/": "landing",
			"/blog/": "blog/index",
			"/blog/introducing-thinkrail/": "blog/introducing-thinkrail",
			"/blog/thinkrail-workspaces/": "blog/thinkrail-workspaces",
			"/blog/thinkrail-sdd/": "blog/thinkrail-sdd",
			"/vibecoding/": "vibecoding",
			"/agentic-development/": "agentic-development",
		});
		for (const [pathname, contentKey] of Object.entries(contentRoutes)) {
			expect(contentKeyForPathname(pathname)).toBe(contentKey);
		}
	});

	test("covers every authored blog slug", async () => {
		const files = await Array.fromAsync(
			new Bun.Glob("*/index.md").scan({
				cwd: `${import.meta.dir}/../content/blog`,
				onlyFiles: true,
			}),
		);
		const authoredPaths = await Promise.all(
			files.map(async (file) => {
				const source = await Bun.file(`${import.meta.dir}/../content/blog/${file}`).text();
				const slug = source.match(/^slug:\s*(.+)$/m)?.[1]?.trim();
				expect(slug).toBeDefined();
				return `/blog/${slug}/`;
			}),
		);
		const classifiedPostPaths = Object.keys(contentRoutes).filter(
			(pathname) => pathname.startsWith("/blog/") && pathname !== "/blog/",
		);
		expect(classifiedPostPaths.sort()).toEqual(authoredPaths.sort());
	});

	test.each([
		"/blog",
		"/blog/unknown/",
		"/docs/",
		"https://thinkrail.ai/",
	])("rejects the unknown pathname %s", (pathname) => {
		expect(contentKeyForPathname(pathname)).toBeUndefined();
	});
});

describe("stable desktop artifacts", () => {
	test("pins every release alias and its bounded properties", () => {
		for (const [url, artifact] of Object.entries(stableDesktopAliases)) {
			expect(desktopArtifactForUrl(url)).toEqual(artifact);
		}
	});

	test.each([
		"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-x64.dmg",
		"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-x64.tar.gz?source=test",
		"https://github.com/JetBrains/thinkrail/releases/download/v1/thinkrail-desktop-windows-x64.zip",
		"/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-windows-x64.zip",
	])("rejects the unknown or non-exact URL %s", (url) => {
		expect(desktopArtifactForUrl(url)).toBeUndefined();
	});
});

describe("CTA classification", () => {
	test.each([
		["#readme", "hero"],
		["#install", "install_section"],
		["#quick-start", "quick_start"],
		["#cta", "final_cta"],
		[".blog-post", "blog_post"],
	] as const)("derives %s as %s", (selector, expected) => {
		expect(ctaLocationForElement(elementAt(selector))).toBe(expected);
	});

	test("does not invent a location for an unrelated element", () => {
		expect(ctaLocationForElement(elementAt("footer"))).toBeUndefined();
	});

	test("captures CLI disclosures only when they open", () => {
		const contentKey: WebsiteContentKey = "landing";
		expect(
			cliDisclosureOpenedEvent(contentKey, disclosure(false, "details.cli-disclosure")),
		).toBeUndefined();
		expect(
			cliDisclosureOpenedEvent(contentKey, disclosure(true, "details.cli-disclosure")),
		).toEqual({
			event: "install_cta_clicked",
			properties: {
				content_key: "landing",
				cta_location: "hero",
				install_method: "cli",
			},
		});
		expect(
			cliDisclosureOpenedEvent(contentKey, disclosure(true, "details.install-reference")),
		).toEqual({
			event: "install_cta_clicked",
			properties: {
				content_key: "landing",
				cta_location: "install_section",
				install_method: "cli",
			},
		});
		expect(cliDisclosureOpenedEvent(contentKey, disclosure(true, "details.other"))).toBeUndefined();
	});
});

describe("analytics event initialization", () => {
	test("a desktop click produces exactly the CTA and download events without a bridge", () => {
		const url = Object.keys(stableDesktopAliases)[0];
		expect(url).toBeDefined();
		expect(desktopClickEvents("landing", "hero", url as string)).toEqual([
			{
				event: "install_cta_clicked",
				properties: {
					content_key: "landing",
					cta_location: "hero",
					install_method: "desktop",
				},
			},
			{
				event: "download_started",
				properties: {
					content_key: "landing",
					cta_location: "hero",
					platform: "macos",
					architecture: "arm64",
					artifact: "dmg",
				},
			},
		]);
	});

	test("is idempotent for content and delegated listeners", () => {
		const document = new FakeDocument();
		const log = captureLog();

		initAnalyticsEvents(document, "/vibecoding/", log.capture);
		initAnalyticsEvents(document, "/vibecoding/", log.capture);

		expect(log.events).toEqual([
			{ event: "content_viewed", properties: { content_key: "vibecoding" } },
		]);
		expect([...document.listeners].map(([type, listeners]) => [type, listeners.length])).toEqual([
			["click", 1],
			["auxclick", 1],
			["toggle", 1],
		]);
	});

	test("delegates primary and middle clicks once each and ignores the middle click duplicate", () => {
		const document = new FakeDocument();
		const log = captureLog();
		const url = Object.keys(stableDesktopAliases)[1] as string;
		const anchor = desktopAnchor(url, "#quick-start");
		let preventDefaultCalls = 0;
		const preventDefault = () => {
			preventDefaultCalls += 1;
		};
		initAnalyticsEvents(document, "/vibecoding/", log.capture);
		log.events.length = 0;

		document.dispatch("click", { button: 0, target: anchor, preventDefault });
		expect(log.events.map(({ event }) => event)).toEqual([
			"install_cta_clicked",
			"download_started",
		]);

		log.events.length = 0;
		document.dispatch("click", { button: 1, target: anchor, preventDefault });
		document.dispatch("auxclick", { button: 1, target: anchor, preventDefault });
		expect(log.events.map(({ event }) => event)).toEqual([
			"install_cta_clicked",
			"download_started",
		]);
		expect(preventDefaultCalls).toBe(0);
	});

	test("delegates open-only CLI disclosure events", () => {
		const document = new FakeDocument();
		const log = captureLog();
		initAnalyticsEvents(document, "/", log.capture);
		log.events.length = 0;

		document.dispatch("toggle", {
			target: disclosure(false, "details.install-reference"),
		});
		document.dispatch("toggle", {
			target: disclosure(true, "details.install-reference"),
		});

		expect(log.events).toEqual([
			{
				event: "install_cta_clicked",
				properties: {
					content_key: "landing",
					cta_location: "install_section",
					install_method: "cli",
				},
			},
		]);
	});
});
