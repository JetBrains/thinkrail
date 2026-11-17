import { describe, expect, test } from "bun:test";
import {
	relativeLinkTargets,
	validateAnalyticsPages,
	validateExtensionsPage,
} from "./validateBuild";

const analyticsRuntime = "data-posthog-project data-gtm-container content_viewed";

describe("relativeLinkTargets", () => {
	test("resolves a post's relative links against the post URL", () => {
		expect(
			relativeLinkTargets(
				"blog/gui-overview/index.html",
				'<a href="./images/a.png"><img src="/_astro/a.webp"></a><a href="images/a.png">',
			),
		).toEqual(["/blog/gui-overview/images/a.png"]);
	});

	test("ignores absolute, external, and fragment links", () => {
		expect(
			relativeLinkTargets(
				"blog/gui-overview/index.html",
				'<a href="/blog/"><a href="https://x.com/ThinkRailAI"><a href="mailto:a@b.c"><a href="#top">',
			),
		).toEqual([]);
	});
});

describe("validateAnalyticsPages", () => {
	test("rejects a newly emitted public page without analytics", () => {
		expect(
			validateAnalyticsPages([{ path: "new-product-page/index.html", runtimeContent: "" }]),
		).toEqual([
			"new-product-page/index.html: expected 1 PostHog loaders",
			"new-product-page/index.html: expected 1 GTM loaders",
		]);
	});

	test("accepts a newly generated blog post with analytics", () => {
		expect(
			validateAnalyticsPages([
				{ path: "blog/a-future-article/index.html", runtimeContent: analyticsRuntime },
			]),
		).toEqual([]);
	});

	test("rejects analytics on the standalone claim and not-found pages", () => {
		const failures = validateAnalyticsPages([
			{ path: "attribution/claim/index.html", runtimeContent: analyticsRuntime },
			{ path: "404.html", runtimeContent: analyticsRuntime },
		]);

		for (const path of ["attribution/claim/index.html", "404.html"]) {
			expect(failures).toContain(`${path}: expected 0 PostHog loaders`);
			expect(failures).toContain(`${path}: expected 0 GTM loaders`);
			expect(failures).toContain(`${path}: browser analytics leaked`);
		}
	});
});

describe("validateExtensionsPage", () => {
	const entry = {
		name: "thinkrail-ext-dice",
		version: "1.0.0",
		description: "Dice.",
		api: "1.0",
		halves: ["server", "web"],
		install: "npm:thinkrail-ext-dice",
		npm: "https://www.npmjs.com/package/thinkrail-ext-dice",
		publishedAt: "2026-11-01T00:00:00.000Z",
	};
	const catalog = (extensions: unknown[]) =>
		JSON.stringify({ schema: 1, generatedAt: "2026-11-17T12:00:00.000Z", extensions });
	const page = (body: string) =>
		`<section data-extensions data-catalog-source="sample">${body}<a href="/docs/build-an-extension/">guide</a></section>`;

	test("accepts one card per catalog entry", () => {
		expect(validateExtensionsPage(page('<article class="ext-card">'), catalog([entry]))).toEqual(
			[],
		);
	});

	test("accepts the empty state for an empty catalog", () => {
		expect(validateExtensionsPage(page('<div class="ext-empty">'), catalog([]))).toEqual([]);
	});

	test("rejects a catalog that breaks the schema or does not parse", () => {
		expect(validateExtensionsPage(page(""), "{")).toEqual(["extensions/catalog.json: not JSON"]);
		expect(
			validateExtensionsPage(
				page('<article class="ext-card">'),
				catalog([{ ...entry, install: "dice" }]),
			),
		).toEqual(["extensions/catalog.json: extensions[0].install must be npm:thinkrail-ext-dice"]);
	});

	test("rejects a page that disagrees with the catalog", () => {
		expect(validateExtensionsPage("<section></section>", catalog([entry]))).toEqual([
			"extensions: renders 0 cards for 1 catalog entries",
			"extensions: missing data-catalog-source",
			"extensions: missing the link to the authoring guide",
		]);
		expect(validateExtensionsPage(page(""), catalog([]))).toEqual([
			"extensions: empty catalog without the empty state",
		]);
	});
});
