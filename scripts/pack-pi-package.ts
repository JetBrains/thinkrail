#!/usr/bin/env bun
// Bootstrap publish helper; see pi-extensions/SPEC.md → Release.
import { mkdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { packPiPackage, publishablePiPackages, repoRoot } from "./pi-packages.ts";

const [, , dirName] = process.argv;
const packages = publishablePiPackages();
const pkg = packages.find((candidate) => basename(candidate.dir) === dirName);
if (!pkg) {
	console.error(
		`usage: bun scripts/pack-pi-package.ts <pi-extensions dir>\navailable: ${packages.map((candidate) => basename(candidate.dir)).join(", ") || "none"}`,
	);
	process.exit(1);
}

const destination = join(repoRoot, "dist", "pi-packages");
mkdirSync(destination, { recursive: true });
const tarball = relative(repoRoot, packPiPackage(pkg, destination));
console.log(`packed ${pkg.name}@${pkg.version} → ${tarball}`);
console.log("\nbootstrap publish (needs npm login with 2FA as an owner of the npm org):");
console.log(`  npm publish ${tarball} --access public --provenance=false`);
console.log(
	"(--provenance=false overrides the manifest's publishConfig for this one manual publish; CI keeps provenance via OIDC)",
);
