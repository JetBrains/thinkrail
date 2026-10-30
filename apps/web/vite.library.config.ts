import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: fileURLToPath(new URL("./library", import.meta.url)),
	base: "./",
	publicDir: fileURLToPath(new URL("./public", import.meta.url)),
	plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
	resolve: {
		alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
	},
	server: { port: Number(process.env.THINKRAIL_LIBRARY_PORT ?? 24391) },
	build: { outDir: fileURLToPath(new URL("./dist-library", import.meta.url)), emptyOutDir: true },
});
