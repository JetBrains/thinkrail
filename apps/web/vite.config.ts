import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hostPort = process.env.THINKRAIL_PORT ?? 24242;

export default defineConfig({
	plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
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
				target: `ws://localhost:${hostPort}`,
				ws: true,
			},
			"/files": { target: `http://localhost:${hostPort}` },
			"/blob": { target: `http://localhost:${hostPort}` },
		},
	},
	build: {
		outDir: "dist",
	},
});
