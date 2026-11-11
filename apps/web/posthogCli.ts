import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export const POSTHOG_CLI_VERSION = "0.18.12";

export const POSTHOG_CLI_BINARY_SHA256: ReadonlyMap<string, string> = new Map([
	["78c21417f3e3d30a88af9970712ab115c303caec21ee3c8ab853a4320968adfa", "aarch64-apple-darwin"],
	["30618b24a8225b70c69348245e155c232bf2b283ade250531c6ba1e98e924cdb", "x86_64-apple-darwin"],
	["1d0e219d2613e06ee13239ee8876b663a04b077906ea7a7478f2a65a6261839a", "aarch64-unknown-linux-gnu"],
	[
		"5142a0f6650e064ad90da025758e5c976223b1456a2c93fe09afcfcb6d725120",
		"aarch64-unknown-linux-musl",
	],
	["c69b03b0d604662ed9939f9017d21e75652b6efe064e0118c6c4378c2f26bc06", "x86_64-unknown-linux-gnu"],
	["8d87bf021c3c4d1afd94e80cf82d094893e6b8f3d1f57f036108e672ed8b246a", "x86_64-unknown-linux-musl"],
	["3ba85040aaca852ab9c65f2256fc351d84925928c9a70fdb4248f0627543d774", "x86_64-pc-windows-msvc"],
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
