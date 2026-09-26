import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"@ext-runtime/remixicon": createRequire(import.meta.url).resolve("@remixicon/react"),
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
			"/auth": `http://localhost:${process.env.THINKRAIL_PORT ?? 24242}`,
			"/ext": `http://localhost:${process.env.THINKRAIL_PORT ?? 24242}`,
			"/files": `http://localhost:${process.env.THINKRAIL_PORT ?? 24242}`,
		},
	},
	build: {
		outDir: "dist",
	},
});
