import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { WebsiteAnalyticsEventName } from "@thinkrail/website-analytics";
import { websitePostHogEnabled } from "./analytics";
import { initDownloadThanks } from "./downloadThanks";

const desktopUrl =
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-arm64.dmg";
const originalElement = Object.getOwnPropertyDescriptor(globalThis, "Element");

type FakeClick = { button: number; target: unknown; preventDefault(): void };

class FakeElement {
	hidden = false;
	disabled = false;
	open = false;
	textContent = "";
	readonly dataset: Record<string, string> = {};
	readonly classList = { add() {}, remove() {} };
	readonly listeners = new Map<string, (event: FakeClick) => void>();
	readonly within: readonly string[];
	readonly href: string | undefined;

	constructor(within: readonly string[] = [], href?: string) {
		this.within = within;
		this.href = href;
	}

	addEventListener(type: string, listener: (event: FakeClick) => void): void {
		this.listeners.set(type, listener);
	}

	closest(selector: string): FakeElement | null {
		if (selector === "a[href]") return this.href === undefined ? null : this;
		return this.within.includes(selector) ? this : null;
	}

	getAttribute(name: string): string | null {
		return name === "href" ? (this.href ?? null) : null;
	}

	querySelector(): FakeElement {
		return new FakeElement();
	}

	showModal(): void {
		this.open = true;
	}

	focus(): void {}
	replaceChildren(): void {}
}

function downloadPage() {
	const dialog = new FakeElement();
	const queried: string[] = [];
	const clickListeners: Array<(event: FakeClick) => void> = [];
	const doc = {
		location: { pathname: "/" },
		querySelector(selector: string) {
			queried.push(selector);
			return selector === "[data-download-thanks]" ? dialog : null;
		},
		addEventListener(type: string, listener: (event: FakeClick) => void) {
			if (type === "click") clickListeners.push(listener);
		},
	};
	const captured: WebsiteAnalyticsEventName[] = [];
	let prevented = false;
	const init = (...postHogEnabled: [] | [boolean]) =>
		initDownloadThanks(
			doc as unknown as Document,
			(event) => captured.push(event),
			() => 0,
			() => "response-1",
			() => undefined,
			...postHogEnabled,
		);
	const clickDownload = () => {
		const event: FakeClick = {
			button: 0,
			target: new FakeElement(["#readme"], desktopUrl),
			preventDefault() {
				prevented = true;
			},
		};
		for (const listener of clickListeners) listener(event);
	};
	return {
		captured,
		clickDownload,
		dialog,
		init,
		prevented: () => prevented,
		queried,
	};
}

beforeEach(() => {
	Object.defineProperty(globalThis, "Element", { configurable: true, value: FakeElement });
});

afterEach(() => {
	if (originalElement) Object.defineProperty(globalThis, "Element", originalElement);
	else Reflect.deleteProperty(globalThis, "Element");
});

describe("download thank-you dialog and the PostHog switch", () => {
	test("with PostHog on, a desktop download opens the dialog and shows the survey", () => {
		const page = downloadPage();

		page.init(true);
		page.clickDownload();

		expect(page.dialog.open).toBeTrue();
		expect(page.captured).toEqual(["survey shown"]);
		expect(page.prevented()).toBeFalse();
	});

	test("with PostHog off, a desktop download proceeds and the dialog never opens", () => {
		const page = downloadPage();

		page.init(false);
		page.clickDownload();

		expect(page.queried).toEqual([]);
		expect(page.dialog.open).toBeFalse();
		expect(page.captured).toEqual([]);
		expect(page.prevented()).toBeFalse();
	});

	test("the site default follows the website PostHog switch", () => {
		const page = downloadPage();

		page.init();
		page.clickDownload();

		expect(page.dialog.open).toBe(websitePostHogEnabled);
	});
});
