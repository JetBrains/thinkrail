import { renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { diffsStub } from "./diffsStub";
import { posthogSourceMapUpload, sourceMapRelease } from "./sourceMapUpload";

function envPort(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined) return undefined;
	const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
	if (port >= 0 && port <= 65535) return port;
	console.warn(`vite: ignoring invalid ${name}=${raw}`);
	return undefined;
}

const hostPort = envPort("THINKRAIL_PORT") ?? 24242;
const webPort = envPort("THINKRAIL_WEB_PORT");

function phoneEntryAsIndex(): Plugin {
	return {
		name: "thinkrail-phone-entry-as-index",
		enforce: "post",
		writeBundle(options) {
			const dir = options.dir ?? "dist-phone";
			renameSync(join(dir, "phone.html"), join(dir, "index.html"));
		},
	};
}

export default defineConfig(({ mode }) => {
	const profile = mode === "profile";
	const phone = mode === "phone";
	const release = profile || phone ? null : sourceMapRelease();
	return {
		plugins: [
			diffsStub(),
			react(),
			babel({ presets: [reactCompilerPreset()] }),
			tailwindcss(),
			...(release ? [posthogSourceMapUpload(release)] : []),
			...(phone ? [phoneEntryAsIndex()] : []),
		],
		resolve: {
			alias: [
				{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
				...(profile ? [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }] : []),
			],
		},
		server: {
			port: webPort ?? 24269,
			strictPort: webPort !== undefined,
			proxy: {
				"/ws": {
					target: `ws://localhost:${hostPort}`,
					ws: true,
				},
				"/speech": {
					target: `ws://localhost:${hostPort}`,
					ws: true,
				},
				"/files": { target: `http://localhost:${hostPort}` },
				"/blob": { target: `http://localhost:${hostPort}` },
				"/fonts": { target: `http://localhost:${hostPort}` },
				"/images": { target: `http://localhost:${hostPort}` },
			},
		},
		worker: { format: "es", plugins: () => [diffsStub()] },
		build: profile
			? { outDir: "dist-profile", minify: false }
			: phone
				? { outDir: "dist-phone", rollupOptions: { input: "phone.html" } }
				: { outDir: "dist", ...(release ? { sourcemap: "hidden" as const } : {}) },
	};
});
