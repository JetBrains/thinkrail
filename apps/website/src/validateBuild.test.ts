import { describe, expect, test } from "bun:test";
import { validateAnalyticsPages, validateReactIslandPages } from "./validateBuild";

const analyticsRuntime = "data-posthog-project data-gtm-container content_viewed";

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

describe("validateReactIslandPages", () => {
	test("rejects an island on a future normal page", () => {
		expect(
			validateReactIslandPages(
				new Map([["future-page/index.html", "<astro-island></astro-island>"]]),
			),
		).toEqual(["future-page/index.html: React island leaked"]);
	});

	test("accepts a future blog post without an island", () => {
		expect(
			validateReactIslandPages(
				new Map([["blog/future-post/index.html", "<article>Future post</article>"]]),
			),
		).toEqual([]);
	});

	test("leaves the two approved island routes to their required-island checks", () => {
		expect(
			validateReactIslandPages(
				new Map([
					["vibecoding/index.html", "<astro-island></astro-island>"],
					["agentic-development/index.html", "<astro-island></astro-island>"],
				]),
			),
		).toEqual([]);
	});
});
