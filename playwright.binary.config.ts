import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { artifactHostEnvironment, artifactPlaywrightConfig } from "./e2e/artifactPlaywright";
import { E2E_BINARY_CACHE, E2E_BINARY_PORT } from "./e2e/fixtures/paths";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const binary =
	process.env.THINKRAIL_E2E_BINARY ??
	fileURLToPath(new URL("./apps/cli/dist/thinkrail", import.meta.url));
if (!existsSync(binary)) {
	throw new Error(`binary not found at ${binary} — run \`bun run build:binary\` first.`);
}
const origin = `http://localhost:${E2E_BINARY_PORT}`;

export default defineConfig({
	...artifactPlaywrightConfig("binary", origin, true),
	webServer: {
		command: `"${binary}" --no-open`,
		cwd: rootDir,
		url: `${origin}/health`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			...artifactHostEnvironment(E2E_BINARY_CACHE),
			THINKRAIL_PORT: String(E2E_BINARY_PORT),
		},
	},
});
