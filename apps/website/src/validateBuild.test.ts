import { describe, expect, test } from "bun:test";
import type { CatalogEntry } from "./extensionCatalog";
import {
	duplicateIds,
	forbiddenOutputFailures,
	localOutputUrls,
	ownedOutput,
	relativeLinkTargets,
	splitSiteHeader,
	validateAnalyticsPages,
	validateExtensionsPage,
	validateHeaderInstall,
	validatePostInstall,
} from "./validateBuild";

const analyticsRuntime = "data-posthog-project data-gtm-container content_viewed";

const downloads = [
	"thinkrail-desktop-darwin-arm64.dmg",
	"thinkrail-desktop-darwin-x64.dmg",
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
		).toHaveLength(5);
	});

	test("rejects a header install panel missing the Intel Mac build", () => {
		const intelDownload = `<a href="https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-x64.dmg">`;
		expect(
			validateHeaderInstall(path, `<header>${panel.replace(intelDownload, "")}</header>`),
		).toEqual([
			`${path}: header install panel must offer https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-x64.dmg once`,
		]);
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

const showcasePath = "extensions/index.html";

const baseEntry: CatalogEntry = {
	name: "thinkrail-ext-dice",
	version: "1.0.0",
	description: "Dice.",
	api: "1.0",
	halves: ["server", "web"],
	install: "npm:thinkrail-ext-dice",
	npm: "https://www.npmjs.com/package/thinkrail-ext-dice",
	publishedAt: "2026-11-01T00:00:00.000Z",
};

const hostileEntry: CatalogEntry = {
	name: "thinkrail-ext-lovable.fonts.googleapis.com",
	version: "1.0.0-lovable.data-posthog-project",
	title: "<astro-island> data-posthog-project fonts.gstatic.com",
	description:
		'Lovable integration for ThinkRail. /__l5e/ content_viewed attribution_claimed data-install-popover <img src="https://evil.example/x.png"> src="/does-not-exist.png" href="missing.html" id="editor-scroll" class="ext-card" data-catalog-source="npm" </div></div></div></section> <div class="ext-grid" data-catalog-entries> <script>alert(1)</script>',
	author: `Mallory orbitron-landing-creator data-gtm-container "quoted" id="editor-scroll" > ' &`,
	api: "1.0",
	halves: ["server"],
	install: "npm:thinkrail-ext-lovable.fonts.googleapis.com",
	npm: "https://www.npmjs.com/package/thinkrail-ext-lovable.fonts.googleapis.com",
	repository: "https://evil.example/lovable/fonts.googleapis.com/__l5e/x.png?a=1&b=2",
	publishedAt: "2026-11-02T00:00:00.000Z",
};

const authorText = [
	"lovable",
	"mallory",
	"fonts.googleapis.com",
	"fonts.gstatic.com",
	"/__l5e/",
	"orbitron-landing-creator",
	"content_viewed",
	"attribution_claimed",
	"<astro-island",
	"evil.example",
	"does-not-exist.png",
];

const escapeText = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

function card(entry: CatalogEntry): string {
	const search = [entry.title, entry.name, entry.description, entry.author]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return `<article class="ext-card" data-extension-search="${escapeAttribute(search)}"> <div class="ext-card-body"> <h2 class="ext-card-title">${escapeText(entry.title ?? entry.name)}</h2> <p class="ext-card-meta"> <code class="ext-card-name">${escapeText(entry.name)}</code> <span>v${escapeText(entry.version)}</span> </p> <p class="ext-card-description">${escapeText(entry.description)}</p> <p class="ext-card-author">by ${escapeText(entry.author ?? "")}</p> <ul class="ext-card-halves" aria-label="Contributes"> <li class="blog-tag">Agent tools</li> </ul> <div class="install-line ext-card-install"> <code class="ext-card-source">${escapeText(entry.install)}</code> <button type="button" class="copy-btn" data-copy="${escapeAttribute(entry.install)}" aria-label="${escapeAttribute(`Copy install source ${entry.install}`)}"> <svg class="i" aria-hidden="true"> <use href="#i-copy"></use> </svg> <svg class="i i-done" aria-hidden="true"> <use href="#i-check"></use> </svg> </button> </div> <p class="ext-card-links"> <a href="${escapeAttribute(entry.npm)}">npm</a> ${entry.repository === undefined ? "" : `<a href="${escapeAttribute(entry.repository)}" rel="ugc nofollow">Repository</a>`} </p> </div> </article>`;
}

const catalog = (extensions: unknown[]) =>
	JSON.stringify({ schema: 1, generatedAt: "2026-11-17T12:00:00.000Z", extensions });

function showcase(
	entries: readonly CatalogEntry[],
	{ before = "", inside = "", after = "" } = {},
): string {
	const grid =
		entries.length === 0 && inside === ""
			? '<div class="ext-empty"><h2 class="ext-empty-title">No extensions yet</h2></div>'
			: `<div class="ext-grid" data-catalog-entries>${entries.map(card).join("")}${inside}</div>`;
	return `<!DOCTYPE html><html lang="en"><head><title>Extensions — ThinkRail</title><script type="module" data-posthog-project="phc_test" data-gtm-container="GTM-TEST"></script></head><body><header class="titlebar"><div class="install-popover" popover data-install-popover>${downloads}</div></header><main class="editor" id="editor-scroll"><section class="ext-page" data-extensions data-catalog-source="sample"><p class="ext-notice"><a href="/docs/build-an-extension/">Build your own</a>.</p>${before}${grid}${after}<p class="ext-footnote"><a href="/extensions/catalog.json">catalog.json</a></p></section></main></body></html>`;
}

describe("validateExtensionsPage", () => {
	test("accepts one card per catalog entry", () => {
		expect(validateExtensionsPage(showcase([baseEntry]), catalog([baseEntry]))).toEqual([]);
	});

	test("accepts the empty state for an empty catalog", () => {
		expect(validateExtensionsPage(showcase([]), catalog([]))).toEqual([]);
	});

	test("rejects a catalog that breaks the schema or does not parse", () => {
		expect(validateExtensionsPage(showcase([]), "{")).toEqual([
			"extensions/catalog.json: not JSON",
		]);
		expect(
			validateExtensionsPage(showcase([baseEntry]), catalog([{ ...baseEntry, install: "dice" }])),
		).toEqual(["extensions/catalog.json: extensions[0].install must be npm:thinkrail-ext-dice"]);
	});

	test("rejects a page that disagrees with the catalog", () => {
		expect(validateExtensionsPage("<section></section>", catalog([baseEntry]))).toEqual([
			"extensions: renders 0 cards for 1 catalog entries",
			"extensions: missing data-catalog-source",
			"extensions: missing the link to the authoring guide",
		]);
		expect(
			validateExtensionsPage(showcase([baseEntry]).replace('class="ext-empty"', ""), catalog([])),
		).toEqual([
			"extensions: the catalog region copies npm:thinkrail-ext-dice",
			"extensions: the catalog region links to https://www.npmjs.com/package/thinkrail-ext-dice",
			"extensions: renders 1 cards for 0 catalog entries",
			"extensions: empty catalog without the empty state",
		]);
	});

	test("rejects a card outside the catalog region", () => {
		expect(
			validateExtensionsPage(
				showcase([baseEntry], { after: card(baseEntry) }),
				catalog([baseEntry]),
			),
		).toEqual([
			"extensions: renders 2 cards for 1 catalog entries",
			"extensions: a card outside the catalog region",
		]);
	});

	test("rejects an image from another origin outside the catalog region", () => {
		for (const src of ["https://example.com/p.png", "//example.com/p.png"]) {
			expect(
				validateExtensionsPage(
					showcase([baseEntry], { after: `<img alt="" src="${src}">` }),
					catalog([baseEntry]),
				),
			).toEqual(["extensions: loads an image from another origin"]);
		}
		expect(
			validateExtensionsPage(
				showcase([baseEntry], { after: '<img alt="" src="/_astro/a.webp">' }),
				catalog([baseEntry]),
			),
		).toEqual([]);
	});

	test("allows only the elements, attributes and links the card template emits in the region", () => {
		const page = (inside: string) =>
			validateExtensionsPage(showcase([baseEntry], { inside }), catalog([baseEntry]));
		expect(page('<img alt="" src="/_astro/a.webp">')).toEqual([
			"extensions: the catalog region contains <img>",
		]);
		for (const [tag, markup] of [
			["iframe", '<iframe src="https://evil.example/"></iframe>'],
			["link", '<link rel="stylesheet" href="/x.css">'],
			["style", "<style>p{}</style>"],
			["script", "<script>alert(1)</script>"],
		] as const) {
			expect(page(markup)).toEqual([`extensions: the catalog region contains <${tag}>`]);
		}
		expect(page('<p class="x" onclick="alert(1)"></p>')).toEqual([
			"extensions: <p onclick> in the catalog region",
		]);
		expect(page('<p id="x"></p>')).toEqual(["extensions: <p id> in the catalog region"]);
		expect(page('<a href="https://evil.example/">x</a>')).toEqual([
			"extensions: the catalog region links to https://evil.example/",
		]);
		expect(page('<a href="/does-not-exist/">x</a>')).toEqual([
			"extensions: the catalog region links to /does-not-exist/",
		]);
		expect(page('<svg class="i"><use href="/sprite.svg#x"></use></svg>')).toEqual([
			"extensions: the catalog region links to /sprite.svg#x",
		]);
		expect(page('<button type="button" data-copy="npm:other"></button>')).toEqual([
			"extensions: the catalog region copies npm:other",
		]);
	});

	test("rejects a catalog region that is not well-formed or not unique", () => {
		for (const inside of ["<div>", "</p>", "<!-- x -->", "<p/>", "<p>a</div>"]) {
			expect(
				validateExtensionsPage(showcase([baseEntry], { inside }), catalog([baseEntry])),
			).toContain("extensions: the catalog region is not well-formed markup");
		}
		expect(
			validateExtensionsPage(
				showcase([baseEntry], { after: '<div class="ext-grid" data-catalog-entries></div>' }),
				catalog([baseEntry]),
			),
		).toEqual(["extensions: more than one catalog region"]);
	});
});

describe("catalog-supplied text never reaches a first-party check", () => {
	test("the reviewer's scenario: a description naming Lovable passes the forbidden-output scan", () => {
		const entry = { ...baseEntry, description: "Lovable integration for ThinkRail" };
		const page = showcase([entry]);

		expect(page).toContain("Lovable integration for ThinkRail");
		expect(forbiddenOutputFailures(showcasePath, page)).toEqual([]);
		expect(validateExtensionsPage(page, catalog([entry]))).toEqual([]);
	});

	test("hostile author text trips no check, and the region still validates", () => {
		const entries = [baseEntry, hostileEntry];
		const page = showcase(entries);
		const owned = ownedOutput(showcasePath, page);

		expect(forbiddenOutputFailures("docs/index.html", page).length).toBeGreaterThan(0);
		expect(page).toContain("<astro-island");
		for (const text of authorText) expect(owned.toLowerCase()).not.toContain(text);

		expect(forbiddenOutputFailures(showcasePath, page)).toEqual([]);
		expect(validateHeaderInstall(showcasePath, owned)).toEqual([]);
		expect(validateAnalyticsPages([{ path: showcasePath, runtimeContent: owned }])).toEqual([]);
		expect(validateExtensionsPage(page, catalog(entries))).toEqual([]);
	});

	test("escaping alone already keeps the attribute-parsing checks immune", () => {
		const page = showcase([baseEntry, hostileEntry]);

		expect(duplicateIds(page)).toEqual([]);
		expect(relativeLinkTargets(showcasePath, page)).toEqual([]);
		expect(localOutputUrls(page)).toEqual([
			"/docs/build-an-extension/",
			"/extensions/catalog.json",
		]);
		expect(page).not.toContain('data-catalog-source="npm"');
		expect(page).toContain("<img src=&quot;https://evil.example/x.png");
		expect(page).not.toMatch(/<img\b[^>]*\ssrc="/);
	});

	test("forged region markers in author text cannot end the region early or open another", () => {
		const page = showcase([
			hostileEntry,
			{
				...baseEntry,
				name: "zz-ext",
				install: "npm:zz-ext",
				npm: "https://www.npmjs.com/package/zz-ext",
			},
		]);
		const owned = ownedOutput(showcasePath, page);

		expect(owned).not.toContain("zz-ext");
		expect(owned).not.toContain("ext-card");
		expect(owned).toContain('<p class="ext-footnote">');
	});

	test("first-party checks stay as strict on owned content", () => {
		const entries = [hostileEntry];
		for (const [before, after] of [
			["<p>Lovable</p>", ""],
			["", "<p>Lovable</p>"],
		]) {
			expect(forbiddenOutputFailures(showcasePath, showcase(entries, { before, after }))).toEqual([
				`${showcasePath}: lovable`,
			]);
		}
		expect(
			forbiddenOutputFailures(
				"docs/index.html",
				showcase([baseEntry], { inside: "<p>lovable</p>" }),
			),
		).toEqual(["docs/index.html: lovable"]);
		const loader =
			'<script data-posthog-project="phc_test" data-gtm-container="GTM-TEST"></script>';
		expect(
			validateAnalyticsPages([
				{
					path: showcasePath,
					runtimeContent: ownedOutput(showcasePath, showcase(entries, { after: loader })),
				},
			]),
		).toEqual([
			`${showcasePath}: expected 1 PostHog loaders`,
			`${showcasePath}: expected 1 GTM loaders`,
		]);
		expect(ownedOutput(showcasePath, showcase(entries, { after: "<astro-island>" }))).toContain(
			"<astro-island",
		);
	});

	test("a malformed region is not stripped, so every check reads the whole page", () => {
		const page = showcase([hostileEntry], { inside: "<div>" });
		expect(ownedOutput(showcasePath, page)).toBe(page);
		expect(forbiddenOutputFailures(showcasePath, page).length).toBeGreaterThan(0);
	});

	test("the published catalog file is validated by its schema, not by the text scan", () => {
		expect(forbiddenOutputFailures("extensions/catalog.json", catalog([hostileEntry]))).toEqual([]);
	});
});
