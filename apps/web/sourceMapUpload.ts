import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

export const SOURCE_MAP_RELEASE_NAME = "thinkrail";

export function sourceMapRelease(
	env: Record<string, string | undefined> = process.env,
): string | null {
	const release = env.THINKRAIL_SOURCEMAPS_RELEASE?.trim();
	if (!release) return null;
	if (!env.POSTHOG_CLI_API_KEY || !env.POSTHOG_CLI_PROJECT_ID) {
		throw new Error(
			"THINKRAIL_SOURCEMAPS_RELEASE needs POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID",
		);
	}
	return release;
}

export function listSourceMaps(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return listSourceMaps(path);
		return name.endsWith(".map") ? [path] : [];
	});
}

function runPosthogCli(args: string[]): void {
	const cli = createRequire(import.meta.url).resolve("@posthog/cli/run-posthog-cli.js");
	const result = spawnSync("bun", [cli, ...args], { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`posthog-cli exited ${result.status ?? result.signal}`);
}

export function posthogSourceMapUpload(release: string): Plugin {
	let outDir = "dist";
	return {
		name: "thinkrail:posthog-sourcemaps",
		apply: "build",
		configResolved(config) {
			outDir = resolve(config.root, config.build.outDir);
		},
		closeBundle() {
			runPosthogCli([
				"sourcemap",
				"process",
				"--directory",
				outDir,
				"--release-name",
				SOURCE_MAP_RELEASE_NAME,
				"--release-version",
				release,
				"--release-mode",
				"symbol-set",
				"--delete-after",
			]);
			const left = listSourceMaps(outDir);
			if (left.length) throw new Error(`source maps left in the web build: ${left.join(", ")}`);
		},
	};
}
