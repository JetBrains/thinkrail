import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: Number(process.env.THINKRAIL_WEB_PORT ?? 24269),
		strictPort: process.env.THINKRAIL_WEB_PORT !== undefined,
		proxy: {
			"/ws": {
				target: `ws://localhost:${process.env.THINKRAIL_PORT ?? 24242}`,
				ws: true,
			},
		},
	},
	build: {
		outDir: "dist",
	},
});
