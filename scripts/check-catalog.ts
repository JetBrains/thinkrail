#!/usr/bin/env bun

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
