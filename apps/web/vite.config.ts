import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hostPort = process.env.THINKRAIL_PORT ?? 24242;

export default defineConfig(({ mode }) => {
	const profile = mode === "profile";
	return {
		plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
		resolve: {
			alias: [
				{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
				...(profile ? [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }] : []),
			],
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
		worker: { format: "es" },
		build: profile ? { outDir: "dist-profile", minify: false } : { outDir: "dist" },
	};
});
