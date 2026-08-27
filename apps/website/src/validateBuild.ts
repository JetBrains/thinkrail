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

async function outputPathExists(distDirectory: string, url: string): Promise<boolean> {
	const pathname = new URL(url, "https://thinkrail.ai").pathname;
	const relativePath = pathname.replace(/^\/+/, "");
	const candidates = pathname.endsWith("/")
		? [`${distDirectory}/${relativePath}index.html`]
		: [`${distDirectory}/${relativePath}`, `${distDirectory}/${relativePath}/index.html`];
	return (await Promise.all(candidates.map((path) => Bun.file(path).exists()))).some(Boolean);
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

	const pages = {
		landing: await Bun.file(`${distDirectory}/index.html`).text(),
		blog: await Bun.file(`${distDirectory}/blog/index.html`).text(),
		vibecoding: await Bun.file(`${distDirectory}/vibecoding/index.html`).text(),
	};

	for (const required of [
		'<link rel="canonical" href="https://thinkrail.ai/vibecoding/">',
		'<meta property="og:url" content="https://thinkrail.ai/vibecoding/">',
		'<meta property="og:image" content="https://thinkrail.ai/vibecoding/og.png">',
		'<link rel="icon" href="/vibecoding/favicon.svg" type="image/svg+xml">',
		'src="/vibecoding/thinkrail-text-logo-gradient.svg"',
	]) {
		if (!pages.vibecoding.includes(required)) {
			failures.push(`vibecoding/index.html missing: ${required}`);
		}
	}

	for (const [name, html] of Object.entries(pages)) {
		if (occurrences(html, "data-posthog-project") !== 1) {
			failures.push(`${name}: expected one PostHog loader`);
		}
		if (occurrences(html, "data-gtm-container") !== 1) {
			failures.push(`${name}: expected one GTM loader`);
		}
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

	for (const name of ["landing", "blog"] as const) {
		if (pages[name].includes("<astro-island")) failures.push(`${name}: React island leaked`);
	}
	if (occurrences(pages.vibecoding, "<astro-island") !== 1) {
		failures.push("vibecoding: expected one React island");
	}

	const ideStyles = new Set([...stylesheetUrls(pages.landing), ...stylesheetUrls(pages.blog)]);
	for (const stylesheet of stylesheetUrls(pages.vibecoding)) {
		if (ideStyles.has(stylesheet)) failures.push(`shared route stylesheet: ${stylesheet}`);
	}

	const ids = [...pages.vibecoding.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
	const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
	for (const id of new Set(duplicateIds)) failures.push(`vibecoding duplicate id: ${id}`);

	const robots = await Bun.file(`${distDirectory}/robots.txt`).text();
	if (!robots.includes("Sitemap: https://thinkrail.ai/sitemap-index.xml")) {
		failures.push("robots.txt missing production sitemap");
	}
	const sitemap = await Bun.file(`${distDirectory}/sitemap-0.xml`).text();
	for (const url of requiredSitemapUrls) {
		if (!sitemap.includes(`<loc>${url}</loc>`)) failures.push(`sitemap missing: ${url}`);
	}

	if (failures.length > 0) {
		throw new Error(`Invalid website build:\n${failures.join("\n")}`);
	}
}

if (import.meta.main) await validateBuild();
