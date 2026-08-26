import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: "https://vibecoding.thinkrail.ai",
	output: "static",
	integrations: [react()],
	vite: {
		plugins: [tailwindcss()],
	},
});
