import { catalogErrors, type ExtensionCatalog } from "./extensionCatalog";

const forbiddenOutput = [
	"/__l5e/",
	"lovable",
	"orbitron-landing-creator",
	"fonts.googleapis.com",
	"fonts.gstatic.com",
] as const;

const requiredSitemapUrls = [
	"https://thinkrail.ai/",
	"https://thinkrail.ai/blog/",
	"https://thinkrail.ai/vibecoding/",
	"https://thinkrail.ai/docs/",
	"https://thinkrail.ai/docs/build-an-extension/",
	"https://thinkrail.ai/docs/extension-reference/",
	"https://thinkrail.ai/extensions/",
] as const;

const desktopDownloadUrls = [
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-arm64.dmg",
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-x64.dmg",
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-windows-x64.zip",
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-x64.tar.gz",
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-arm64.tar.gz",
] as const;

const analyticsFreePages = new Set(["404.html", "attribution/claim/index.html"]);

const showcasePage = "extensions/index.html";
const catalogFile = "extensions/catalog.json";
const catalogRegionStart = '<div class="ext-grid" data-catalog-entries>';
const markupToken = /<(\/?)([a-z][a-z\d-]*)((?:\s+[a-z][a-z\d-]*(?:="[^"]*")?)*)\s*>|[^<]+/y;
const catalogRegionAttributes = new Map<string, readonly string[]>([
	["article", ["class", "data-extension-search"]],
	["div", ["class"]],
	["h2", ["class"]],
	["p", ["class"]],
	["code", ["class"]],
	["span", []],
	["ul", ["class", "aria-label"]],
	["li", ["class"]],
	["button", ["type", "class", "data-copy", "aria-label"]],
	["svg", ["class", "aria-hidden"]],
	["use", ["href"]],
	["a", ["href", "rel"]],
]);
const voidElements = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
]);
const entities: Record<string, string> = {
	"&quot;": '"',
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&#39;": "'",
};

interface RegionTag {
	name: string;
	attributes: [string, string][];
}

type CatalogRegion = { owned: string; tags: RegionTag[] } | { error: string };

function regionAttributes(source: string): [string, string][] {
	return [...source.matchAll(/\s+([a-z][a-z\d-]*)(?:="([^"]*)")?/g)].map((match) => [
		match[1] ?? "",
		(match[2] ?? "").replace(/&(?:quot|amp|lt|gt|#39);/g, (entity) => entities[entity] ?? entity),
	]);
}

function catalogRegion(html: string): CatalogRegion {
	const start = html.indexOf(catalogRegionStart);
	if (start < 0) return { owned: html, tags: [] };
	if (html.includes(catalogRegionStart, start + 1)) {
		return { error: "more than one catalog region" };
	}
	const malformed = { error: "the catalog region is not well-formed markup" };
	const token = new RegExp(markupToken);
	token.lastIndex = start + catalogRegionStart.length;
	const open = ["div"];
	const tags: RegionTag[] = [];
	while (open.length > 0) {
		const match = token.exec(html);
		if (match === null) return malformed;
		const [, closing, name, attributes = ""] = match;
		if (name === undefined) continue;
		if (closing === "/") {
			if (attributes !== "" || open.pop() !== name) return malformed;
			continue;
		}
		if (!voidElements.has(name)) open.push(name);
		tags.push({ name, attributes: regionAttributes(attributes) });
	}
	return { owned: html.slice(0, start) + html.slice(token.lastIndex), tags };
}

function catalogRegionErrors(tags: readonly RegionTag[], catalog: ExtensionCatalog): string[] {
	const links = new Set(
		catalog.extensions.flatMap(({ npm, repository }) =>
			repository === undefined ? [npm] : [npm, repository],
		),
	);
	const installs = new Set(catalog.extensions.map((entry) => entry.install));
	const failures = new Set<string>();
	for (const { name, attributes } of tags) {
		const allowed = catalogRegionAttributes.get(name);
		if (allowed === undefined) {
			failures.add(`extensions: the catalog region contains <${name}>`);
			continue;
		}
		for (const [attribute, value] of attributes) {
			if (!allowed.includes(attribute)) {
				failures.add(`extensions: <${name} ${attribute}> in the catalog region`);
			} else if (
				attribute === "href" &&
				!(name === "use" ? /^#i-[a-z-]+$/.test(value) : links.has(value))
			) {
				failures.add(`extensions: the catalog region links to ${value}`);
			} else if (attribute === "data-copy" && !installs.has(value)) {
				failures.add(`extensions: the catalog region copies ${value}`);
			}
		}
	}
	return [...failures];
}

export function ownedOutput(path: string, content: string): string {
	if (path === catalogFile) return "";
	if (path !== showcasePage) return content;
	const region = catalogRegion(content);
	return "error" in region ? content : region.owned;
}

export function forbiddenOutputFailures(path: string, content: string): string[] {
	const owned = ownedOutput(path, content).toLowerCase();
	return forbiddenOutput
		.filter((forbidden) => owned.includes(forbidden))
		.map((forbidden) => `${path}: ${forbidden}`);
}

function occurrences(content: string, value: string): number {
	return content.split(value).length - 1;
}

function attributeValues(content: string, attributes: string[]): string[] {
	const expression = new RegExp(`(?:${attributes.join("|")})="([^"]+)"`, "g");
	return [...content.matchAll(expression)].map((match) => match[1] ?? "");
}

export function splitSiteHeader(html: string): { header: string; body: string } {
	const start = html.indexOf("<header");
	const close = start < 0 ? -1 : html.indexOf("</header>", start);
	if (close < 0) return { header: "", body: html };
	const end = close + "</header>".length;
	return { header: html.slice(start, end), body: html.slice(0, start) + html.slice(end) };
}

export function validateHeaderInstall(path: string, html: string): string[] {
	const failures: string[] = [];
	const { header } = splitSiteHeader(html);
	const panel = /\sdata-install-popover[\s=>]/g;
	if (html.match(panel)?.length !== 1 || header.match(panel)?.length !== 1) {
		failures.push(`${path}: expected one install panel in the site header`);
	}
	for (const url of desktopDownloadUrls) {
		if (occurrences(header, url) !== 1) {
			failures.push(`${path}: header install panel must offer ${url} once`);
		}
	}
	return failures;
}

export function validatePostInstall(path: string, html: string): string[] {
	const failures: string[] = [];
	const picker = 'data-install-picker="blog"';
	if (
		occurrences(html, picker) !== 1 ||
		html.indexOf("Browser UI via command line", html.indexOf(picker)) < 0
	) {
		failures.push(`${path}: blog install picker is missing`);
	}
	const row = 'data-install-launcher="post"';
	const postHeader = html.indexOf('class="blog-post-header"');
	const rowIndex = html.indexOf(row);
	if (
		occurrences(html, row) !== 1 ||
		postHeader < 0 ||
		rowIndex < postHeader ||
		rowIndex > html.indexOf("</header>", postHeader)
	) {
		failures.push(`${path}: post header install row is missing`);
	}
	return failures;
}

export function duplicateIds(html: string): string[] {
	const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? "");
	return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

export function relativeLinkTargets(pagePath: string, html: string): string[] {
	const page = `https://thinkrail.ai/${pagePath.replace(/index\.html$/, "")}`;
	return [
		...new Set(
			attributeValues(html, ["src", "href"])
				.filter((value) => !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value))
				.map((value) => new URL(value, page).pathname),
		),
	];
}

export function localOutputUrls(html: string): string[] {
	return [
		...new Set(
			attributeValues(html, ["src", "href", "component-url", "renderer-url"]).filter((value) =>
				value.startsWith("/"),
			),
		),
	];
}

function stylesheetUrls(content: string): Set<string> {
	return new Set(
		[...content.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
			(match) => match[1] ?? "",
		),
	);
}

async function pageRuntimeContent(distDirectory: string, html: string): Promise<string> {
	const pending = attributeValues(html, ["src"]).filter(
		(value) => value.startsWith("/") && value.endsWith(".js"),
	);
	const visited = new Set<string>();
	const scripts: string[] = [];
	while (pending.length > 0) {
		const url = pending.pop();
		if (url === undefined || visited.has(url)) continue;
		visited.add(url);
		const content = await Bun.file(`${distDirectory}/${url.replace(/^\/+/, "")}`).text();
		scripts.push(content);
		for (const match of content.matchAll(/(?:from|import)\s*["']([^"']+\.js)["']/g)) {
			const imported = match[1];
			if (imported === undefined) continue;
			const importedUrl = new URL(imported, `https://thinkrail.ai${url}`).pathname;
			if (!visited.has(importedUrl)) pending.push(importedUrl);
		}
	}
	return [html, ...scripts].join("\n");
}

async function outputPathExists(distDirectory: string, url: string): Promise<boolean> {
	const pathname = new URL(url, "https://thinkrail.ai").pathname;
	const relativePath = pathname.replace(/^\/+/, "");
	const candidates = pathname.endsWith("/")
		? [`${distDirectory}/${relativePath}index.html`]
		: [`${distDirectory}/${relativePath}`, `${distDirectory}/${relativePath}/index.html`];
	return (await Promise.all(candidates.map((path) => Bun.file(path).exists()))).some(Boolean);
}

export function validateExtensionsPage(html: string, catalogText: string): string[] {
	let catalog: unknown;
	try {
		catalog = JSON.parse(catalogText);
	} catch {
		return ["extensions/catalog.json: not JSON"];
	}
	const failures = catalogErrors(catalog).map((error) => `${catalogFile}: ${error}`);
	if (failures.length > 0) return failures;
	const valid = catalog as ExtensionCatalog;
	const listed = valid.extensions.length;
	const region = catalogRegion(html);
	const owned = "error" in region ? html : region.owned;
	if ("error" in region) failures.push(`extensions: ${region.error}`);
	else failures.push(...catalogRegionErrors(region.tags, valid));
	const cards = occurrences(html, 'class="ext-card"');
	if (cards !== listed) {
		failures.push(`extensions: renders ${cards} cards for ${listed} catalog entries`);
	}
	if (!("error" in region) && occurrences(owned, 'class="ext-card"') > 0) {
		failures.push("extensions: a card outside the catalog region");
	}
	if (listed === 0 && !owned.includes('class="ext-empty"')) {
		failures.push("extensions: empty catalog without the empty state");
	}
	if (!/data-catalog-source="(?:npm|sample)"/.test(owned)) {
		failures.push("extensions: missing data-catalog-source");
	}
	if (!owned.includes('href="/docs/build-an-extension/"')) {
		failures.push("extensions: missing the link to the authoring guide");
	}
	if (/<img\b[^>]*\ssrc="(?:https?:)?\/\//i.test(owned)) {
		failures.push("extensions: loads an image from another origin");
	}
	return failures;
}

export function validateAnalyticsPages(
	pages: readonly { path: string; runtimeContent: string }[],
): string[] {
	const failures: string[] = [];
	for (const { path, runtimeContent } of pages) {
		const expectedLoaders = analyticsFreePages.has(path) ? 0 : 1;
		if (occurrences(runtimeContent, "data-posthog-project") !== expectedLoaders) {
			failures.push(`${path}: expected ${expectedLoaders} PostHog loaders`);
		}
		if (occurrences(runtimeContent, "data-gtm-container") !== expectedLoaders) {
			failures.push(`${path}: expected ${expectedLoaders} GTM loaders`);
		}
		if (
			expectedLoaders === 0 &&
			(runtimeContent.includes("content_viewed") || runtimeContent.includes("attribution_claimed"))
		) {
			failures.push(`${path}: browser analytics leaked`);
		}
	}
	return failures;
}

export async function validateBuild(distDirectory = `${import.meta.dir}/../dist`) {
	const failures: string[] = [];
	const glob = new Bun.Glob("**/*.{html,css,js,svg,txt,xml}");
	for await (const path of glob.scan({ cwd: distDirectory, onlyFiles: true })) {
		failures.push(
			...forbiddenOutputFailures(path, await Bun.file(`${distDirectory}/${path}`).text()),
		);
	}

	const htmlPages = new Map<string, string>();
	const htmlGlob = new Bun.Glob("**/*.html");
	for await (const path of htmlGlob.scan({ cwd: distDirectory, onlyFiles: true })) {
		htmlPages.set(path, ownedOutput(path, await Bun.file(`${distDirectory}/${path}`).text()));
	}
	const requiredPage = (path: string): string => {
		const html = htmlPages.get(path);
		if (html === undefined) throw new Error(`Missing website HTML output: ${path}`);
		return html;
	};
	requiredPage("404.html");
	const pages = {
		landing: requiredPage("index.html"),
		blog: requiredPage("blog/index.html"),
		introducingThinkRail: requiredPage("blog/introducing-thinkrail/index.html"),
		vibecoding: requiredPage("vibecoding/index.html"),
		agenticDevelopment: requiredPage("agentic-development/index.html"),
		agenticIde: requiredPage("agentic-ide/index.html"),
		claim: requiredPage("attribution/claim/index.html"),
		docs: requiredPage("docs/index.html"),
		buildAnExtension: requiredPage("docs/build-an-extension/index.html"),
		extensionReference: requiredPage("docs/extension-reference/index.html"),
		extensions: requiredPage("extensions/index.html"),
	};
	const islandPages = ["vibecoding", "agenticDevelopment", "agenticIde"] as const;
	const staticPages = [
		"landing",
		"blog",
		"introducingThinkRail",
		"claim",
		"docs",
		"buildAnExtension",
		"extensionReference",
		"extensions",
	] as const;
	const installPages = [
		{ name: "landing", html: splitSiteHeader(pages.landing).body, expectedDownloads: 1 },
		{
			name: "introducingThinkRail",
			html: splitSiteHeader(pages.introducingThinkRail).body,
			expectedDownloads: 2,
		},
		...islandPages.map((name) => ({
			name,
			html: splitSiteHeader(pages[name]).body,
			expectedDownloads: 1,
		})),
	] as const;

	for (const name of islandPages) {
		for (const required of [
			'<link rel="canonical" href="https://thinkrail.ai/vibecoding/">',
			'<meta property="og:url" content="https://thinkrail.ai/vibecoding/">',
			'<meta property="og:image" content="https://thinkrail.ai/vibecoding/og.png">',
			'<link rel="icon" href="/vibecoding/favicon.svg" type="image/svg+xml">',
			'src="/vibecoding/thinkrail-text-logo-gradient.svg"',
		]) {
			if (!pages[name].includes(required)) {
				failures.push(`${name}: missing ${required}`);
			}
		}
	}
	if (!pages.vibecoding.includes("Vibe code without losing control.")) {
		failures.push("vibecoding: missing hero title");
	}
	if (!pages.agenticDevelopment.includes("Agentic development without losing control.")) {
		failures.push("agenticDevelopment: missing hero title");
	}
	if (pages.agenticDevelopment.includes("Vibe code without losing control.")) {
		failures.push("agenticDevelopment: hero title fell back to the vibecoding default");
	}
	for (const required of [
		'<meta name="robots" content="noindex, nofollow, noarchive">',
		'<meta name="referrer" content="no-referrer">',
	]) {
		if (!pages.claim.includes(required)) failures.push(`claim: missing ${required}`);
	}
	if (!pages.agenticIde.includes("The agentic IDE that gets better every time you use it.")) {
		failures.push("agenticIde: missing hero title");
	}
	if (pages.agenticIde.includes("Vibe code without losing control.")) {
		failures.push("agenticIde: hero title fell back to the vibecoding default");
	}
	for (const [name, marker] of [
		["agenticIde", "Designed to compound"],
		["vibecoding", "Designed for high-trust development"],
		["agenticDevelopment", "Designed for high-trust development"],
	] as const) {
		if (!pages[name].includes(marker)) {
			failures.push(`${name}: missing positioning copy: ${marker}`);
		}
	}
	for (const name of ["vibecoding", "agenticDevelopment"] as const) {
		if (pages[name].includes("Designed to compound")) {
			failures.push(`${name}: compounding positioning copy leaked into the control variant`);
		}
	}

	for (const url of desktopDownloadUrls) {
		for (const { name, html, expectedDownloads } of installPages) {
			if (occurrences(html, url) !== expectedDownloads) {
				failures.push(`${name}: expected desktop download ${expectedDownloads} time(s): ${url}`);
			}
		}
	}
	if (!pages.landing.includes('data-file="INSTALL.md"')) {
		failures.push("landing: install section is not INSTALL.md");
	}
	for (const name of ["landing", ...islandPages] as const) {
		for (const redundantCopy of [
			"Native desktop application",
			"Installs the CLI-only host",
			"Prefer the command line?",
			"Install via CLI",
		]) {
			if (pages[name].includes(redundantCopy)) {
				failures.push(`${name}: retained redundant install copy: ${redundantCopy}`);
			}
		}
	}
	if (!pages.landing.includes("data-hero-download")) {
		failures.push("landing: hero download is missing");
	}
	if (!pages.landing.includes("Thanks for downloading ThinkRail!")) {
		failures.push("landing: download thanks dialog is missing");
	}
	if (
		!/class="hero-download-other"[^>]*href="#install"|href="#install"[^>]*class="hero-download-other"/.test(
			pages.landing,
		)
	) {
		failures.push("landing: other platforms link is missing");
	}
	if (!pages.landing.includes("data-cli-install")) {
		failures.push("landing: install command tabs are missing");
	}
	for (const [path, html] of htmlPages) {
		if (!analyticsFreePages.has(path)) failures.push(...validateHeaderInstall(path, html));
		for (const id of duplicateIds(html)) failures.push(`${path} duplicate id: ${id}`);
		if (!/^(?:blog|docs)\/[^/]+\/index\.html$/.test(path)) continue;
		if (path.startsWith("blog/")) failures.push(...validatePostInstall(path, html));
		if (
			path.startsWith("docs/") &&
			!html.includes('<a class="tree-row page selected" href="/docs/"')
		) {
			failures.push(`${path}: the Docs rail row is not selected`);
		}
		for (const url of relativeLinkTargets(path, html)) {
			if (!(await outputPathExists(distDirectory, url))) {
				failures.push(`${path}: missing local output for ${url}`);
			}
		}
	}
	for (const [name, href] of [
		["docs", "/docs/"],
		["extensions", "/extensions/"],
	] as const) {
		if (!pages.landing.includes(`<a class="tree-row page" href="${href}"`)) {
			failures.push(`landing: rail row missing: ${href}`);
		}
		if (!pages[name].includes(`<a class="tree-row page selected" href="${href}"`)) {
			failures.push(`${name}: its rail row is not selected`);
		}
	}
	const catalogPath = `${distDirectory}/${catalogFile}`;
	if (await Bun.file(catalogPath).exists()) {
		failures.push(
			...validateExtensionsPage(
				await Bun.file(`${distDirectory}/${showcasePage}`).text(),
				await Bun.file(catalogPath).text(),
			),
		);
	} else {
		failures.push(`${catalogFile}: missing`);
	}
	if (!pages.landing.includes("Browser UI via command line")) {
		failures.push("landing: browser UI command-line option is missing");
	}
	for (const name of islandPages) {
		const { body } = splitSiteHeader(pages[name]);
		for (const [content, forbiddenCommandLineCopy] of [
			[pages[name], "Browser UI via command line"],
			[body, "raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh"],
			[body, "raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1"],
		] as const) {
			if (content.includes(forbiddenCommandLineCopy)) {
				failures.push(`${name}: command-line option leaked: ${forbiddenCommandLineCopy}`);
			}
		}
	}
	for (const { name, html } of installPages) {
		const desktopIndex = html.indexOf(desktopDownloadUrls[0]);
		const secondaryLabel =
			name === "landing"
				? "Browser UI via command line"
				: name === "introducingThinkRail"
					? "Prefer the command line?"
					: null;
		const secondaryIndex = secondaryLabel ? html.indexOf(secondaryLabel) : -1;
		if (desktopIndex < 0 || (secondaryLabel && secondaryIndex < desktopIndex)) {
			failures.push(`${name}: desktop download is not presented before the secondary option`);
		}
		if (!html.includes("./installer")) {
			failures.push(`${name}: Linux desktop installation cue is missing`);
		}
	}

	const analyticsPages: { path: string; runtimeContent: string }[] = [];
	for (const [path, html] of htmlPages) {
		analyticsPages.push({ path, runtimeContent: await pageRuntimeContent(distDirectory, html) });
	}
	failures.push(...validateAnalyticsPages(analyticsPages));

	for (const [name, html] of Object.entries(pages)) {
		for (const url of localOutputUrls(html)) {
			if (!(await outputPathExists(distDirectory, url))) {
				failures.push(`${name}: missing local output for ${url}`);
			}
		}
	}

	for (const name of staticPages) {
		if (pages[name].includes("<astro-island")) failures.push(`${name}: React island leaked`);
	}
	for (const name of islandPages) {
		if (occurrences(pages[name], "<astro-island") !== 1) {
			failures.push(`${name}: expected one React island`);
		}
	}

	const ideStyles = new Set([...stylesheetUrls(pages.landing), ...stylesheetUrls(pages.blog)]);
	for (const name of islandPages) {
		for (const stylesheet of stylesheetUrls(pages[name])) {
			if (ideStyles.has(stylesheet)) failures.push(`shared route stylesheet: ${stylesheet}`);
		}
	}

	for (const icon of ["favicon.ico", "apple-touch-icon.png"]) {
		if (!(await Bun.file(`${distDirectory}/${icon}`).exists())) failures.push(`missing ${icon}`);
	}
	for (const name of ["landing", "blog"] as const) {
		for (const required of [
			'<link rel="icon" href="/favicon.ico" sizes="32x32">',
			'<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
		]) {
			if (!pages[name].includes(required)) failures.push(`${name}: missing ${required}`);
		}
	}

	const robots = await Bun.file(`${distDirectory}/robots.txt`).text();
	if (!robots.includes("Sitemap: https://thinkrail.ai/sitemap-index.xml")) {
		failures.push("robots.txt missing production sitemap");
	}
	const sitemap = await Bun.file(`${distDirectory}/sitemap-0.xml`).text();
	for (const url of requiredSitemapUrls) {
		if (!sitemap.includes(`<loc>${url}</loc>`)) failures.push(`sitemap missing: ${url}`);
	}
	if (sitemap.includes("https://thinkrail.ai/agentic-development/")) {
		failures.push("sitemap lists the non-canonical agentic-development route");
	}
	if (sitemap.includes("https://thinkrail.ai/agentic-ide/")) {
		failures.push("sitemap lists the non-canonical agentic-ide route");
	}
	if (sitemap.includes("https://thinkrail.ai/attribution/claim/")) {
		failures.push("sitemap lists the non-indexed attribution claim route");
	}
	const headers = await Bun.file(`${distDirectory}/_headers`).text();
	for (const required of [
		"/attribution/claim/*",
		"Cache-Control: no-store",
		"Referrer-Policy: no-referrer",
		"X-Robots-Tag: noindex, nofollow, noarchive",
		"Content-Security-Policy: frame-ancestors 'none'",
		"X-Frame-Options: DENY",
	]) {
		if (!headers.includes(required)) failures.push(`headers: missing ${required}`);
	}
	if (
		!/^\/extensions\/catalog\.json\n(?:[ \t]+.*\n)*?[ \t]+Access-Control-Allow-Origin: \*$/m.test(
			headers,
		)
	) {
		failures.push("headers: catalog.json is not CORS-open");
	}

	const redirects = await Bun.file(`${distDirectory}/_redirects`).text();
	if (!/^\/discord https:\/\/discord\.gg\/\S+ 302$/m.test(redirects)) {
		failures.push("redirects: missing /discord invite");
	}

	if (failures.length > 0) {
		throw new Error(`Invalid website build:\n${failures.join("\n")}`);
	}
}

if (import.meta.main) await validateBuild();
