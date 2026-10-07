import { describe, expect, test } from "bun:test";
import type { WebsiteAnalyticsEventProperties } from "@thinkrail/website-analytics";
import {
	cliDisclosureOpenedEvent,
	contentKeyForPathname,
	ctaLocationForElement,
	desktopArtifactForUrl,
	desktopClickEvents,
	githubClickedEvent,
	githubLocationForElement,
	githubTargetForUrl,
	initAnalyticsEvents,
	installCommandCopiedEvent,
	installLinkShareClickedEvent,
} from "./analyticsEvents";
import { installCommands } from "./installCommands";

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

function attributeElement(
	locationSelector: string,
	ownSelector: string,
	attributes: Record<string, string>,
) {
	return {
		closest(selector: string) {
			if (selector === ownSelector || selector === locationSelector) return this;
			return null;
		},
		getAttribute(name: string) {
			return attributes[name] ?? null;
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

describe("website content keys", () => {
	test.each([
		["/", "landing"],
		["/blog/", "blog/index"],
		["/blog/introducing-thinkrail/", "blog/introducing-thinkrail"],
		["/blog/thinkrail-workspaces/", "blog/thinkrail-workspaces"],
		["/blog/thinkrail-sdd/", "blog/thinkrail-sdd"],
		["/vibecoding/", "vibecoding"],
		["/agentic-development/", "agentic-development"],
		["/agentic-ide/", "agentic-ide"],
	] as const)("keeps %s mapped to %s", (pathname, contentKey) => {
		expect(contentKeyForPathname(pathname)).toBe(contentKey);
	});

	test("derives a content key for a newly authored path", () => {
		expect(contentKeyForPathname("/blog/some-new-post/")).toBe("blog/some-new-post");
		expect(contentKeyForPathname("/docs/setup/")).toBe("docs/setup");
	});

	test("accepts 100-character blog slugs but rejects 101-character slugs", () => {
		const maximumSlug = "a".repeat(100);
		expect(contentKeyForPathname(`/blog/${maximumSlug}/`)).toBe(`blog/${maximumSlug}`);
		expect(contentKeyForPathname(`/blog/${maximumSlug}a/`)).toBeUndefined();
	});

	test.each([
		"/Blog/new-post/",
		"/blog/new.post/",
		"/blog/new%2dpost/",
		`/${"a".repeat(106)}/`,
		"/docs//setup/",
		"https://thinkrail.ai/",
	])("rejects an unsafe pathname %s", (pathname) => {
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
		const contentKey = "landing";
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

describe("GitHub link classification", () => {
	test.each([
		["https://github.com/JetBrains/thinkrail", "repo"],
		["https://github.com/JetBrains/thinkrail/", "repo"],
		["https://github.com/JetBrains/thinkrail#install", "repo"],
		["https://github.com/JetBrains/thinkrail/releases", "releases"],
		["https://github.com/JetBrains/thinkrail/releases/tag/v1.0.0", "releases"],
		["https://github.com/JetBrains/thinkrail/issues", "other"],
		["https://github.com/JetBrains/thinkrail/blob/main/LICENSE", "other"],
	] as const)("classifies %s as %s", (url, target) => {
		expect(githubTargetForUrl(url)).toBe(target);
	});

	test.each([
		...Object.keys(stableDesktopAliases),
		"https://github.com/JetBrains/thinkrail-other",
		"https://github.com/JetBrains",
		"https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh",
		"#quick-start",
	])("ignores %s", (url) => {
		expect(githubTargetForUrl(url)).toBeUndefined();
	});

	test.each([
		[".blog-post", "blog_post"],
		["#readme", "hero"],
		["#top", "hero"],
		["#install", "install_section"],
		["header", "header"],
		["#contributing", "footer"],
		["footer", "footer"],
		[".terminal", "terminal"],
		["#mock-tooltip", "mock_hint"],
		["main", "other"],
	] as const)("derives the GitHub location %s as %s", (selector, expected) => {
		expect(githubLocationForElement(elementAt(selector))).toBe(expected);
	});

	test("builds a bounded GitHub click event", () => {
		expect(
			githubClickedEvent("vibecoding", elementAt("#top"), "https://github.com/JetBrains/thinkrail"),
		).toEqual({
			event: "github_clicked",
			properties: { content_key: "vibecoding", cta_location: "hero", target: "repo" },
		});
	});
});

describe("install command copies and link shares", () => {
	test.each([
		[installCommands.macos, "sh"],
		[installCommands.windows.powershell, "powershell"],
		[installCommands.windows.cmd, "cmd"],
	] as const)("maps the copied command to its shell %s", (command, shell) => {
		const button = attributeElement("#install", "[data-copy]", { "data-copy": command });
		expect(installCommandCopiedEvent("landing", button)).toEqual({
			event: "install_command_copied",
			properties: { content_key: "landing", cta_location: "install_section", shell },
		});
	});

	test("ignores unknown copied values and copies outside the install controls", () => {
		expect(
			installCommandCopiedEvent(
				"landing",
				attributeElement("#install", "[data-copy]", { "data-copy": "echo hi" }),
			),
		).toBeUndefined();
		expect(
			installCommandCopiedEvent(
				"landing",
				attributeElement("#cta", "[data-copy]", { "data-copy": installCommands.macos }),
			),
		).toBeUndefined();
	});

	test("derives share locations only for the hero and quick start", () => {
		expect(installLinkShareClickedEvent("landing", elementAt("#readme"))).toEqual({
			event: "install_link_share_clicked",
			properties: { content_key: "landing", cta_location: "hero" },
		});
		expect(installLinkShareClickedEvent("vibecoding", elementAt("#quick-start"))).toEqual({
			event: "install_link_share_clicked",
			properties: { content_key: "vibecoding", cta_location: "quick_start" },
		});
		expect(installLinkShareClickedEvent("landing", elementAt("#install"))).toBeUndefined();
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

	test("captures a view for a new blog post without a route registration", () => {
		const document = new FakeDocument();
		const log = captureLog();
		let attributionInitializations = 0;

		initAnalyticsEvents(document, "/blog/some-new-post/", log.capture, () => {
			attributionInitializations += 1;
		});

		expect(log.events).toEqual([
			{ event: "content_viewed", properties: { content_key: "blog/some-new-post" } },
		]);
		expect(attributionInitializations).toBe(1);
		expect([...document.listeners.keys()]).toEqual(["click", "auxclick", "toggle"]);
	});

	test.each([
		"/Blog/new-post/",
		"/blog/new.post/",
		"/blog/new%2dpost/",
		`/blog/${"a".repeat(101)}/`,
	])("does not initialize events for an unsafe pathname %s", (pathname) => {
		const document = new FakeDocument();
		const log = captureLog();
		let attributionInitializations = 0;

		initAnalyticsEvents(document, pathname, log.capture, () => {
			attributionInitializations += 1;
		});

		expect(log.events).toEqual([]);
		expect(document.listeners.size).toBe(0);
		expect(attributionInitializations).toBe(0);
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

	test("records live attribution and adds a prepared bridge before each desktop download", () => {
		const document = new FakeDocument();
		const log = captureLog();
		const order: string[] = [];
		const capture: Capture = ((event, properties) => {
			order.push(event);
			log.capture(event, properties);
		}) as Capture;
		const url = Object.keys(stableDesktopAliases)[1] as string;
		const anchor = desktopAnchor(url, "#quick-start");
		let preventDefaultCalls = 0;
		const preventDefault = () => {
			preventDefaultCalls += 1;
		};
		initAnalyticsEvents(
			document,
			"/vibecoding/",
			capture,
			() => order.push("init_touch"),
			() => order.push("action_touch"),
			() => {
				order.push("download_bridge");
				return "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
			},
		);
		log.events.length = 0;
		order.length = 0;

		document.dispatch("click", { button: 0, target: anchor, preventDefault });
		expect(order).toEqual([
			"action_touch",
			"install_cta_clicked",
			"action_touch",
			"download_bridge",
			"download_started",
		]);
		expect(log.events[1]?.properties).toMatchObject({
			bridge_id: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		});

		log.events.length = 0;
		order.length = 0;
		document.dispatch("click", { button: 1, target: anchor, preventDefault });
		document.dispatch("auxclick", { button: 1, target: anchor, preventDefault });
		expect(order).toEqual([
			"action_touch",
			"install_cta_clicked",
			"action_touch",
			"download_bridge",
			"download_started",
		]);
		expect(preventDefaultCalls).toBe(0);
	});

	test("records a live attribution touch before an open-only CLI disclosure event", () => {
		const document = new FakeDocument();
		const log = captureLog();
		const touches: number[] = [];
		initAnalyticsEvents(
			document,
			"/",
			log.capture,
			() => {},
			() => touches.push(1),
		);
		log.events.length = 0;

		document.dispatch("toggle", {
			target: disclosure(false, "details.install-reference"),
		});
		document.dispatch("toggle", {
			target: disclosure(true, "details.install-reference"),
		});

		expect(touches).toEqual([1]);
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

	test("delegates GitHub, copy, and share clicks with a live attribution touch each", () => {
		const document = new FakeDocument();
		const log = captureLog();
		const order: string[] = [];
		const capture: Capture = ((event, properties) => {
			order.push(event);
			log.capture(event, properties);
		}) as Capture;
		initAnalyticsEvents(
			document,
			"/",
			capture,
			() => {},
			() => order.push("action_touch"),
			() => {
				order.push("download_bridge");
				return undefined;
			},
		);
		log.events.length = 0;
		order.length = 0;

		const github = desktopAnchor("https://github.com/JetBrains/thinkrail", "header");
		const copy = attributeElement("#readme", "[data-copy]", { "data-copy": installCommands.linux });
		const share = attributeElement("#readme", "[data-share-install-link]", {});
		document.dispatch("click", { button: 0, target: github });
		document.dispatch("auxclick", { button: 1, target: github });
		document.dispatch("click", { button: 0, target: copy });
		document.dispatch("auxclick", { button: 1, target: copy });
		document.dispatch("click", { button: 0, target: share });

		expect(order).toEqual([
			"action_touch",
			"github_clicked",
			"action_touch",
			"github_clicked",
			"action_touch",
			"install_command_copied",
			"action_touch",
			"install_link_share_clicked",
		]);
		expect(log.events.map(({ properties }) => properties)).toEqual([
			{ content_key: "landing", cta_location: "header", target: "repo" },
			{ content_key: "landing", cta_location: "header", target: "repo" },
			{ content_key: "landing", cta_location: "hero", shell: "sh" },
			{ content_key: "landing", cta_location: "hero" },
		]);
	});
});
