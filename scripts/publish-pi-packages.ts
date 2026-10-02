#!/usr/bin/env bun
// CI publish step for pi-extensions/*; see pi-extensions/SPEC.md → Release. `--dry-run` packs only.
import { appendFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
const outputFile = process.argv[process.argv.indexOf("--github-output") + 1];

function report(published: number, readyToTag: boolean): void {
	if (process.argv.includes("--github-output") && outputFile) {
		appendFileSync(
			outputFile,
			`published=${!dryRun && published > 0}\nreadyToTag=${!dryRun && readyToTag}\n`,
		);
	}
}

const pendingChangesets = readdirSync(join(repoRoot, ".changeset")).filter(
	(name) => name.endsWith(".md") && name !== "README.md",
);
if (pendingChangesets.length > 0) {
	console.log(
		`publish-pi-packages: ${pendingChangesets.length} pending changeset(s) — versions not bumped yet, nothing to publish (run \`bun run release:version\` in a PR first)`,
	);
	report(0);
	process.exit(0);
}
const packages = dependenciesFirst(publishablePiPackages());
if (packages.length === 0) {
	console.log("publish-pi-packages: nothing to publish");
	report(0, false);
	process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "thinkrail-pi-publish-"));
let published = 0;
let onNpm = 0;
try {
	for (const pkg of packages) {
		if (publishedVersions(pkg.name).has(pkg.version)) {
			console.log(`  = ${pkg.name}@${pkg.version} already on npm`);
			onNpm += 1;
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
report(published, onNpm + published === packages.length);
console.log(`publish-pi-packages: ${published} package(s) ${dryRun ? "would be " : ""}published`);
