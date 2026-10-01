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
] as const;

const desktopDownloadUrls = [
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-arm64.dmg",
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-windows-x64.zip",
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-x64.tar.gz",
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-arm64.tar.gz",
] as const;

const analyticsFreePages = new Set(["404.html", "attribution/claim/index.html"]);

function occurrences(content: string, value: string): number {
	return content.split(value).length - 1;
}

function attributeValues(content: string, attributes: string[]): string[] {
	const expression = new RegExp(`(?:${attributes.join("|")})="([^"]+)"`, "g");
	return [...content.matchAll(expression)].map((match) => match[1] ?? "");
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
		const content = await Bun.file(`${distDirectory}/${path}`).text();
		for (const forbidden of forbiddenOutput) {
			if (content.toLowerCase().includes(forbidden)) failures.push(`${path}: ${forbidden}`);
		}
	}

	const htmlPages = new Map<string, string>();
	const htmlGlob = new Bun.Glob("**/*.html");
	for await (const path of htmlGlob.scan({ cwd: distDirectory, onlyFiles: true })) {
		htmlPages.set(path, await Bun.file(`${distDirectory}/${path}`).text());
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
	};
	const islandPages = ["vibecoding", "agenticDevelopment", "agenticIde"] as const;
	const staticPages = ["landing", "blog", "introducingThinkRail", "claim"] as const;
	const installPages = [
		{ name: "landing", html: pages.landing, expectedDownloads: 2 },
		{
			name: "introducingThinkRail",
			html: pages.introducingThinkRail,
			expectedDownloads: 1,
		},
		...islandPages.map((name) => ({ name, html: pages[name], expectedDownloads: 1 })),
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
	if (!pages.landing.includes("Browser UI via command line")) {
		failures.push("landing: browser UI command-line option is missing");
	}
	for (const name of islandPages) {
		for (const forbiddenCommandLineCopy of [
			"Browser UI via command line",
			"raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh",
			"raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1",
		]) {
			if (pages[name].includes(forbiddenCommandLineCopy)) {
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
		for (const url of new Set(
			attributeValues(html, ["src", "href", "component-url", "renderer-url"]).filter((value) =>
				value.startsWith("/"),
			),
		)) {
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

	for (const name of islandPages) {
		const ids = [...pages[name].matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
		const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
		for (const id of new Set(duplicateIds)) failures.push(`${name} duplicate id: ${id}`);
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

	if (failures.length > 0) {
		throw new Error(`Invalid website build:\n${failures.join("\n")}`);
	}
}

if (import.meta.main) await validateBuild();
