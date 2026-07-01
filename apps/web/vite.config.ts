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
		// The dev launcher (`bun run dev`) pre-picks a free port and pins it here via THINKRAIL_PI_WEB_PORT
		// so it can open the browser at the exact URL; `strictPort` then fails loud rather than letting vite
		// drift out from under it. A bare `dev:web` leaves it unset → 24269, free to auto-increment.
		port: Number(process.env.THINKRAIL_PI_WEB_PORT ?? 24269),
		strictPort: process.env.THINKRAIL_PI_WEB_PORT !== undefined,
		proxy: {
			// The dev launcher (`bun run dev`) sets THINKRAIL_PI_PORT to the host's free port; match it.
			"/ws": {
				target: `ws://localhost:${process.env.THINKRAIL_PI_PORT ?? 24242}`,
				ws: true,
			},
		},
	},
	build: {
		outDir: "dist",
	},
});
