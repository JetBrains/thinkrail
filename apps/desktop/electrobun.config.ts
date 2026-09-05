import type { ElectrobunConfig } from "electrobun";

const version = process.env.THINKRAIL_DESKTOP_VERSION;
if (!version) throw new Error("THINKRAIL_DESKTOP_VERSION is required");

export default {
	app: {
		name: "ThinkRail",
		identifier: "ai.thinkrail.app",
		version,
	},
	runtime: {
		exitOnLastWindowClosed: true,
	},
	build: {
		mainProcess: "bun",
		bun: { entrypoint: "src/index.ts" },
		copy: {
			".stage/web": "views/web",
			".stage/runtime": "runtime",
		},
		mac: { bundleCEF: false, icons: "assets/icon.iconset" },
		linux: { bundleCEF: false, icon: "assets/icon.png" },
		win: { bundleCEF: false, icon: "assets/icon.ico" },
	},
} satisfies ElectrobunConfig;
