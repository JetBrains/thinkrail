import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export const POSTHOG_CLI_VERSION = "0.18.10";

export const POSTHOG_CLI_BINARY_SHA256: ReadonlyMap<string, string> = new Map([
	["2bb92e1cd4807a70b9b35507ef35cbf4f422920044238f2982f08301050c8aec", "aarch64-apple-darwin"],
	["99229762f831aa78ddec827f2e43c3e90b197b3396be564f8f2b28102ad10278", "x86_64-apple-darwin"],
	["6746401e700ab246c2863a842c06710633c583dd0aa298f122fb02d5eb487f22", "aarch64-unknown-linux-gnu"],
	[
		"590f09ee1816808df804e46b170d553ea65fb61c9bbe6907f6db71b424d9131d",
		"aarch64-unknown-linux-musl",
	],
	["661f5cacbe426442f31ee39211b94a97a5b8b718dd13c9b7c72c125084c2d24e", "x86_64-unknown-linux-gnu"],
	["08ceaa681db94932b2585a5c26272e46ebcae207dd817ee6f85ef5ddd71da652", "x86_64-unknown-linux-musl"],
	["336b1fee6e84fc46164369c6e5ab5996e053e66529afe79dd5166980ba949234", "x86_64-pc-windows-msvc"],
]);

interface PosthogCliPackage {
	exists(): boolean;
	install(suppressLogs?: boolean): Promise<void> | undefined;
	installDirectory: string;
	binaries: Record<string, string>;
}

export function assertPinnedPosthogCli(binary: string): void {
	const digest = createHash("sha256").update(readFileSync(binary)).digest("hex");
	if (!POSTHOG_CLI_BINARY_SHA256.has(digest)) {
		throw new Error(
			`refusing to run ${binary}: sha256 ${digest} is not a pinned posthog-cli binary`,
		);
	}
}

export async function posthogCliBinary(): Promise<string> {
	const { version } = require("@posthog/cli/package.json") as { version: string };
	if (version !== POSTHOG_CLI_VERSION) {
		throw new Error(
			`@posthog/cli ${version} has no pinned binary checksums (${POSTHOG_CLI_VERSION} has)`,
		);
	}
	const { getPackage } = require("@posthog/cli/binary.js") as { getPackage(): PosthogCliPackage };
	const cli = getPackage();
	if (!cli.exists()) await cli.install(true);
	const binary = join(cli.installDirectory, cli.binaries["posthog-cli"] ?? "posthog-cli");
	assertPinnedPosthogCli(binary);
	return binary;
}

export async function runPosthogCli(args: readonly string[]): Promise<void> {
	const result = spawnSync(await posthogCliBinary(), args, { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`posthog-cli exited ${result.status ?? result.signal}`);
}

if (import.meta.main) {
	runPosthogCli(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
