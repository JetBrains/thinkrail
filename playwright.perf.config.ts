import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { resolveBunExecutable } from "./e2e/fixtures/executables";
import base from "./playwright.config";

const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("perf config expects one e2e webServer");

const profileDir = fileURLToPath(new URL("./apps/web/dist-profile", import.meta.url));
const bun = JSON.stringify(resolveBunExecutable());
const host = `${bun} packages/server/src/dev.ts`;

export default defineConfig({
	...base,
	testDir: "./e2e/perf",
	testMatch: "**/*.perf.ts",
	testIgnore: [],
	fullyParallel: false,
	workers: 1,
	retries: 0,
	timeout: 180_000,
	reporter: "list",
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks"] },
			},
		},
	],
	webServer: {
		...server,
		command:
			process.env.THINKRAIL_E2E_SKIP_BUILD === "1"
				? host
				: `${bun} run --cwd apps/web build:profile && ${host}`,
		env: { ...server.env, THINKRAIL_STATIC_DIR: profileDir },
	},
});
