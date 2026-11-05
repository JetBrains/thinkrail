#!/usr/bin/env bun

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entry = join(repoRoot, "packages", "server", "src", "dev.ts");

const child = Bun.spawn(["bun", "--watch", entry], {
	cwd: repoRoot,
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});

const stop = (signal: NodeJS.Signals): void => {
	child.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

process.exit(await child.exited);
