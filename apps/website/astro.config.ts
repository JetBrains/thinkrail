import { satteri } from "@astrojs/markdown-satteri";
import { defineConfig } from "astro/config";
import { youTubeEmbeds } from "./src/youTubeEmbeds";

export default defineConfig({
	site: "https://thinkrail.ai",
	markdown: {
		shikiConfig: {
			themes: { light: "github-light", dark: "github-dark" },
			defaultColor: false,
		},
		processor: satteri({ hastPlugins: [youTubeEmbeds] }),
	},
});
