import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { siteMetadata } from "./src/siteMetadata";

export default defineConfig({
	site: siteMetadata.origin,
	output: "static",
	integrations: [react()],
	vite: {
		plugins: [tailwindcss()],
	},
});
