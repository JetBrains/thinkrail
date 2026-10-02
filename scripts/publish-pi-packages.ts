#!/usr/bin/env bun
// CI publish step for pi-extensions/*; see pi-extensions/SPEC.md → Release. `--dry-run` packs only.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	dependenciesFirst,
	packPiPackage,
	publishablePiPackages,
	publishedVersions,
	repoRoot,
	run,
} from "./pi-packages.ts";

const dryRun = process.argv.includes("--dry-run");
const pendingChangesets = readdirSync(join(repoRoot, ".changeset")).filter(
	(name) => name.endsWith(".md") && name !== "README.md",
);
if (pendingChangesets.length > 0) {
	console.log(
		`publish-pi-packages: ${pendingChangesets.length} pending changeset(s) — versions not bumped yet, nothing to publish (run \`bun run release:version\` in a PR first)`,
	);
	process.exit(0);
}
const packages = dependenciesFirst(publishablePiPackages());
if (packages.length === 0) {
	console.log("publish-pi-packages: nothing to publish");
	process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "thinkrail-pi-publish-"));
let published = 0;
try {
	for (const pkg of packages) {
		if (publishedVersions(pkg.name).has(pkg.version)) {
			console.log(`  = ${pkg.name}@${pkg.version} already on npm`);
			continue;
		}
		const tarball = packPiPackage(pkg, scratch);
		const args = ["publish", tarball, "--access", "public", "--provenance"];
		if (dryRun) args.push("--dry-run");
		run("npm", args, pkg.dir);
		console.log(
			`  ${dryRun ? "~" : "+"} ${pkg.name}@${pkg.version}${dryRun ? " (dry run)" : " published"}`,
		);
		published += 1;
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
console.log(`publish-pi-packages: ${published} package(s) ${dryRun ? "would be " : ""}published`);
