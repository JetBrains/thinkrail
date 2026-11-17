import type { WikiPageEntry } from "@thinkrail/contracts";
import { WIKI_ENTRY } from "./pages";

export interface SiteFile {
	path: string;
	content: string;
}

export const SITE_MARKER_FILE = ".thinkrail-wiki";

const RELATIVE_MD_LINK = /\]\(((?![a-z][a-z0-9+.-]*:|\/|#)[^)\s]+?)\.md(#[^)\s]*)?\)/gi;

/** Jekyll serves `Foo.md` as `Foo.html`, so the article links between pages follow. */
export function rewriteMarkdownLinks(markdown: string): string {
	return markdown.replace(RELATIVE_MD_LINK, (_whole, target: string, anchor?: string) => {
		return `](${target}.html${anchor ?? ""})`;
	});
}

function neutralizeLiquid(markdown: string): string {
	return markdown.replaceAll("{% endraw %}", "{ % endraw % }");
}

function frontMatter(title: string): string {
	return `---\nlayout: default\ntitle: ${JSON.stringify(title)}\n---\n\n`;
}

/** The GitHub Pages (Jekyll) source for the wiki: every article with front matter, plus config and an ownership marker. */
export function buildSite(
	pages: readonly (WikiPageEntry & { content: string })[],
	siteTitle: string,
): SiteFile[] {
	const files: SiteFile[] = [
		{
			path: "_config.yml",
			content: `title: ${JSON.stringify(siteTitle)}\ndescription: "Knowledge-graph wiki generated with Graphify through ThinkRail"\ntheme: jekyll-theme-minimal\n`,
		},
		{
			path: SITE_MARKER_FILE,
			content: "Published by ThinkRail. This branch is overwritten on every publish.\n",
		},
	];
	for (const page of pages) {
		const back = page.path === WIKI_ENTRY ? "" : "\n\n---\n\n[Back to the index](index.html)\n";
		files.push({
			path: page.path,
			content: `${frontMatter(page.title)}{% raw %}\n${neutralizeLiquid(rewriteMarkdownLinks(page.content))}\n{% endraw %}${back}`,
		});
	}
	return files;
}

/** `https://<owner>.github.io/<repo>/`, or the bare host for a user/organisation site repository. */
export function defaultPagesUrl(slug: string): string {
	const [owner = "", repo = ""] = slug.split("/");
	const host = `${owner.toLowerCase()}.github.io`;
	return repo.toLowerCase() === host ? `https://${host}/` : `https://${host}/${repo}/`;
}
