import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { posthogSourceMapUpload, sourceMapRelease } from "./sourceMapUpload";

const hostPort = process.env.THINKRAIL_PORT ?? 24242;

// In dev the host is reached through vite's proxy and enforces a per-instance token. The shared dev
// token (set by scripts/dev.ts) is injected as the same <meta> the host writes in production, so the
// dev page authenticates against the proxied `/ws`, `/files` and `/blob`.
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
		build: profile
			? { outDir: "dist-profile", minify: false }
			: { outDir: "dist", ...(release ? { sourcemap: "hidden" as const } : {}) },
	};
});
