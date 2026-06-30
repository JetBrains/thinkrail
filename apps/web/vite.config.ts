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
		port: 24269,
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
