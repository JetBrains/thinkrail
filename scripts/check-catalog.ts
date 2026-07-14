#!/usr/bin/env bun
// Enforces this repo's dependency-pinning policy across every workspace manifest. Two rules, one pass:
//
//   1. Exact pins only. Every dependency pins an EXACT version — no ranges (`^` `~` `>` `<` `.x` `*`).
//      Floating would drift into breakage (pi ships breaking releases daily, and a silent minor bump is
//      the classic "works on my machine" trap); an exact pin makes the lockfile the single source of a
//      dependency's version and every upgrade an explicit, reviewable diff.
//   2. Catalog-managed deps go through the catalog. A dependency listed in the root `workspaces.catalog`
//      must be referenced from workspace manifests only via the `catalog:` protocol, so its version lives
//      in exactly one place; and catalog entries must themselves be exact. A `catalog:` reference that
//      points at no catalog entry is rejected too.
//
// Scope: dependencies/devDependencies/optionalDependencies. peerDependencies are exempt (extension
// packages declare `"*"` there on purpose — the host provides the dependency). Local protocols
// (`workspace:`, `link:`, `file:`, …) are exempt from rule 1 — they don't carry a registry version.
// Exits non-zero listing every violation. Named catalogs (`catalogs` / `catalog:<name>`) are not
// supported — only the single default catalog this repo uses.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Manifest {
	workspaces?: { packages?: string[]; catalog?: Record<string, string> } | string[];
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

const root = join(import.meta.dir, "..");
const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Manifest;

const workspaces = rootManifest.workspaces;
if (workspaces === undefined || Array.isArray(workspaces)) {
	console.error("check-catalog: root workspaces must be the object form carrying a catalog.");
	process.exit(1);
}
const catalog = workspaces.catalog ?? {};
const patterns = workspaces.packages ?? [];

/** Workspace manifest paths from the `<dir>/*` workspace patterns. */
function manifestPaths(): string[] {
	const paths: string[] = [];
	for (const pattern of patterns) {
		const base = pattern.replace(/\/\*$/, "");
		for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const manifest = join(root, base, entry.name, "package.json");
			if (existsSync(manifest)) paths.push(manifest);
		}
	}
	return paths;
}

const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
const violations: string[] = [];

/** Exact semver (optionally with a prerelease/build suffix) — no ranges. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/;

for (const [name, version] of Object.entries(catalog)) {
	if (!EXACT_VERSION.test(version)) {
		violations.push(`package.json: catalog.${name} is "${version}" — catalog entries pin exact`);
	}
}

for (const path of [join(root, "package.json"), ...manifestPaths()]) {
	const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
	const rel = path.slice(root.length + 1);
	for (const section of SECTIONS) {
		for (const [name, version] of Object.entries(manifest[section] ?? {})) {
			if (version.startsWith("catalog:")) {
				if (!(name in catalog)) {
					violations.push(`${rel}: ${section}.${name} references a missing catalog entry`);
				}
				continue;
			}
			if (name in catalog) {
				violations.push(
					`${rel}: ${section}.${name} pins "${version}" — catalog-managed, use "catalog:"`,
				);
				continue;
			}
			// A protocol reference (`workspace:*`, `link:`, `file:`, …) carries no registry version to pin.
			if (version.includes(":")) continue;
			if (!EXACT_VERSION.test(version)) {
				violations.push(
					`${rel}: ${section}.${name} pins "${version}" — pin an exact version (no ranges)`,
				);
			}
		}
	}
}

if (violations.length > 0) {
	console.error("Dependency catalog violations:");
	for (const violation of violations) console.error(`  - ${violation}`);
	process.exit(1);
}
console.log(`check-catalog: OK (${Object.keys(catalog).length} catalog entries enforced)`);
