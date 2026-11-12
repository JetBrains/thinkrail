import { describe, expect, test } from "bun:test";
import {
	duplicateIds,
	relativeLinkTargets,
	splitSiteHeader,
	validateAnalyticsPages,
	validateHeaderInstall,
	validatePostInstall,
} from "./validateBuild";

const analyticsRuntime = "data-posthog-project data-gtm-container content_viewed";

const downloads = [
	"thinkrail-desktop-darwin-arm64.dmg",
	"thinkrail-desktop-windows-x64.zip",
	"thinkrail-desktop-linux-x64.tar.gz",
	"thinkrail-desktop-linux-arm64.tar.gz",
]
	.map(
		(asset) =>
			`<a href="https://github.com/JetBrains/thinkrail/releases/latest/download/${asset}">`,
	)
	.join("");

describe("splitSiteHeader", () => {
	test("separates the first header from the rest of the page", () => {
		expect(splitSiteHeader("<body><header>a</header><main>b</main></body>")).toEqual({
			header: "<header>a</header>",
			body: "<body><main>b</main></body>",
		});
		expect(splitSiteHeader("<main>b</main>")).toEqual({ header: "", body: "<main>b</main>" });
	});
});

describe("validateHeaderInstall", () => {
	const path = "index.html";
	const panel = `<div class="install-popover" popover data-install-popover>${downloads}</div>`;

	test("requires one header install panel offering every desktop download once", () => {
		expect(validateHeaderInstall(path, `<header>${panel}</header><main></main>`)).toEqual([]);
		expect(validateHeaderInstall(path, `<header></header><main>${panel}</main>`)).toContain(
			`${path}: expected one install panel in the site header`,
		);
		expect(validateHeaderInstall(path, `<header>${panel}</header><main>${panel}</main>`)).toEqual([
			`${path}: expected one install panel in the site header`,
		]);
		expect(
			validateHeaderInstall(path, `<header>${panel.replace(downloads, "")}</header>`),
		).toHaveLength(4);
	});

	test("ignores the marker's selector in scripts", () => {
		expect(
			validateHeaderInstall(
				path,
				`<header>${panel}</header><script>q("[data-install-popover]")</script>`,
			),
		).toEqual([]);
	});
});

describe("validatePostInstall", () => {
	const path = "blog/article/index.html";
	const row = '<div class="install-launch" data-install-launcher="post"></div>';
	const header = `<header class="blog-post-header"><h1>Title</h1>${row}</header>`;
	const content = '<div class="blog-post-content">Article</div>';
	const picker =
		'<section><div data-install-picker="blog">Browser UI via command line</div></section>';

	test("requires the post-header row and the end-of-post picker", () => {
		expect(validatePostInstall(path, `${header}${content}${picker}`)).toEqual([]);
		expect(validatePostInstall(path, `${header.replace(row, "")}${content}${picker}`)).toEqual([
			`${path}: post header install row is missing`,
		]);
		expect(validatePostInstall(path, `${header}${content}`)).toEqual([
			`${path}: blog install picker is missing`,
		]);
	});

	test("rejects a row outside the post header and repeated controls", () => {
		expect(
			validatePostInstall(path, `${header.replace(row, "")}${row}${content}${picker}`),
		).toEqual([`${path}: post header install row is missing`]);
		expect(validatePostInstall(path, `${header}${content}${picker}${picker}`)).toEqual([
			`${path}: blog install picker is missing`,
		]);
		expect(
			validatePostInstall(
				path,
				`${header}${content}${picker.replace("Browser UI via command line", "")}`,
			),
		).toEqual([`${path}: blog install picker is missing`]);
	});
});

describe("duplicateIds", () => {
	test("reports each repeated element ID once", () => {
		expect(duplicateIds('<a id="a"></a><b id="b"></b><i id="a"></i><i id="a"></i>')).toEqual(["a"]);
		expect(duplicateIds('<a id="a"></a><a data-id="a"></a>')).toEqual([]);
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
