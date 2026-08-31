import { satteri } from "@astrojs/markdown-satteri";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { youTubeEmbeds } from "./src/youTubeEmbeds";

export default defineConfig({
	site: "https://thinkrail.ai",
	// HTML whitespace rules; the 'jsx' default drops newline spacing around inline tags
	compressHTML: true,
	integrations: [react(), sitemap()],
	vite: {
		plugins: [tailwindcss()],
	},
	markdown: {
		shikiConfig: {
			themes: { light: "github-light", dark: "github-dark" },
			defaultColor: false,
		},
		processor: satteri({ hastPlugins: [youTubeEmbeds] }),
	},
});
