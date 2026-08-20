// Normalizes YouTube embeds in post HTML at build time: every iframe is forced onto the
// youtube-nocookie.com domain (the site's no-consent-banner stance forbids cookie-setting embeds —
// SPEC.md "Blog") and gets a `title` (a11y) and `loading="lazy"` when the author omitted them.
// Authors write plain `<iframe src="https://www.youtube.com/embed/…">`; the build repairs the rest.
//
// Written against Sätteri (Astro's native Markdown processor). Markdown's raw-HTML chunks arrive as
// `raw` string nodes, real elements as `element` nodes — both paths are covered.

import type { SatteriProcessorOptions } from "@astrojs/markdown-satteri";

type HastPlugin = NonNullable<SatteriProcessorOptions["hastPlugins"]>[number];

const EMBED_HOST = /(https?:\/\/)(?:www\.)?youtube\.com\/embed\//g;

export function toNoCookieUrl(url: string): string {
	return url.replace(EMBED_HOST, "$1www.youtube-nocookie.com/embed/");
}

function isYouTubeEmbed(value: string): boolean {
	return /youtube(?:-nocookie)?\.com\/embed\//.test(value);
}

/** Raw-HTML markdown chunks are strings, not elements — repair iframe tags textually. */
export function fixRawHtml(html: string): string {
	return html.replace(/<iframe\b[^>]*>/gi, (tag) => {
		if (!isYouTubeEmbed(tag)) return tag;
		let fixed = toNoCookieUrl(tag);
		if (!/\btitle\s*=/i.test(fixed))
			fixed = fixed.replace(/^<iframe/i, '<iframe title="YouTube video"');
		if (!/\bloading\s*=/i.test(fixed)) fixed = fixed.replace(/^<iframe/i, '<iframe loading="lazy"');
		return fixed;
	});
}

export const youTubeEmbeds: HastPlugin = {
	name: "youtube-nocookie-embeds",
	element: {
		filter: ["iframe"],
		visit(node, ctx) {
			const src = node.properties?.src;
			if (typeof src !== "string" || !isYouTubeEmbed(src)) return;
			ctx.setProperty(node, "src", toNoCookieUrl(src));
			if (node.properties?.title === undefined) ctx.setProperty(node, "title", "YouTube video");
			if (node.properties?.loading === undefined) ctx.setProperty(node, "loading", "lazy");
		},
	},
	raw(node) {
		if (typeof node.value === "string" && node.value.includes("<iframe")) {
			return { type: "raw", value: fixRawHtml(node.value) };
		}
	},
};
