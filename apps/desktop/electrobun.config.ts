import { version } from "@thinkrail/shared/version";
import type { ElectrobunConfig } from "electrobun";

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
		views: { preload: { entrypoint: "src/preload.ts", format: "iife" } },
		copy: {
			"../web/dist": "views/web",
			".stage/runtime": "runtime",
		},
		mac: { bundleCEF: false, icons: "assets/icon.iconset" },
		linux: { bundleCEF: false, icon: "assets/icon.png" },
		win: { bundleCEF: false, icon: "assets/icon.ico" },
	},
	scripts: { preBuild: "preBuild.ts", postBuild: "postBuild.ts" },
} satisfies ElectrobunConfig;
