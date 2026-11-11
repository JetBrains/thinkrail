import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
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

function devInstanceToken() {
	return {
		name: "thinkrail-dev-instance-token",
		apply: "serve" as const,
		transformIndexHtml(html: string) {
			const token = process.env.THINKRAIL_DEV_AUTH_TOKEN;
			if (!token) return html;
			const meta = `<meta name="thinkrail-instance-token" content="${token}">`;
			return html.includes("</head>")
				? html.replace("</head>", `${meta}</head>`)
				: `${meta}${html}`;
		},
	};
}

export default defineConfig(({ mode }) => {
	const profile = mode === "profile";
	const release = profile ? null : sourceMapRelease();
	return {
		plugins: [
			diffsStub(),
			react(),
			babel({ presets: [reactCompilerPreset()] }),
			tailwindcss(),
			devInstanceToken(),
			...(release ? [posthogSourceMapUpload(release)] : []),
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
			},
		},
		worker: { format: "es", plugins: () => [diffsStub()] },
		build: profile
			? { outDir: "dist-profile", minify: false }
			: { outDir: "dist", ...(release ? { sourcemap: "hidden" as const } : {}) },
	};
});
