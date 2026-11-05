import { describe, expect, test } from "bun:test";
import {
	relativeLinkTargets,
	validateAnalyticsPages,
	validateBlogInstallPickers,
} from "./validateBuild";

const analyticsRuntime = "data-posthog-project data-gtm-container content_viewed";

describe("validateBlogInstallPickers", () => {
	const path = "blog/article/index.html";
	const top =
		'<section data-install-picker="blog-top"><button id="blog-top-macos"></button>Browser UI via command line</section>';
	const bottom =
		'<section data-install-picker="blog-bottom"><button id="blog-bottom-macos"></button>Browser UI via command line</section>';
	const body = '<div class="blog-post-content">Article</div>';

	test("requires an install picker on each side of the post body", () => {
		expect(validateBlogInstallPickers(path, `${top}${body}${bottom}`)).toEqual([]);
		expect(
			validateBlogInstallPickers(path, `${top}${body}${bottom}<a data-id="blog-top-macos">`),
		).toEqual([]);
		expect(validateBlogInstallPickers(path, `${body}${bottom}`)).toHaveLength(2);
		expect(validateBlogInstallPickers(path, `${top}${body}`)).toHaveLength(2);
		expect(validateBlogInstallPickers(path, `${body}${top}${bottom}`)).toHaveLength(1);
	});

	test("keeps the command-line install option in both pickers", () => {
		expect(
			validateBlogInstallPickers(
				path,
				`${top}${body}${bottom}`.replaceAll("Browser UI via command line", ""),
			),
		).toEqual([`${path}: blog install pickers are missing the command-line option`]);
	});

	test("rejects repeated pickers and duplicate tab IDs", () => {
		expect(validateBlogInstallPickers(path, `${top}${top}${body}${bottom}`)).toHaveLength(2);
		expect(
			validateBlogInstallPickers(path, `${top}${body}${bottom}<a id="blog-top-macos">`),
		).toEqual([`${path}: duplicate element IDs`]);
	});
});

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
