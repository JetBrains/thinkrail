import { satteri } from "@astrojs/markdown-satteri";
import { defineConfig } from "astro/config";
import { youTubeEmbeds } from "./src/youTubeEmbeds";

// Static output for GitHub Pages at the custom-domain root (https://thinkrail.ai/). The old Vite
// build used a relative `base: "./"`; Astro emits root-absolute asset URLs instead, which is fine
// because the jetbrains.github.io/thinkrail address 301-redirects to the custom domain (SPEC.md).
export default defineConfig({
	site: "https://thinkrail.ai",
	markdown: {
		// Dual-theme code blocks: colors come from --shiki-light/--shiki-dark CSS vars so the site's
		// [data-theme] switch (not a media query) picks the palette. Styled in src/styles.css.
		shikiConfig: {
			themes: { light: "github-light", dark: "github-dark" },
			defaultColor: false,
		},
		processor: satteri({ hastPlugins: [youTubeEmbeds] }),
	},
});
