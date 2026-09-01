#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isExactVersion } from "./exactVersion";

interface Manifest {
	workspaces?: { packages?: string[]; catalog?: Record<string, string> } | string[];
	overrides?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

interface BunLock {
	packages?: Record<string, unknown>;
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

for (const [name, version] of Object.entries(catalog)) {
	if (!isExactVersion(version)) {
		violations.push(`package.json: catalog.${name} is "${version}" — catalog entries pin exact`);
	}
}

for (const name of ["react", "react-dom"]) {
	if (rootManifest.overrides?.[name] !== "catalog:") {
		violations.push(`package.json: overrides.${name} must be "catalog:" to keep one runtime`);
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
			if (!isExactVersion(version)) {
				violations.push(
					`${rel}: ${section}.${name} pins "${version}" — pin an exact version (no ranges)`,
				);
			}
		}
	}
}

const lockModule = await import(join(root, "bun.lock"));
const lock = (lockModule.default ?? lockModule) as BunLock;
for (const name of ["react", "react-dom"]) {
	const prefix = `${name}@`;
	const versions = new Set<string>();
	for (const entry of Object.values(lock.packages ?? {})) {
		if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
		if (entry[0].startsWith(prefix)) versions.add(entry[0].slice(prefix.length));
	}
	const resolved = [...versions].sort();
	if (resolved.length > 1) {
		violations.push(`bun.lock: ${name} resolves to multiple versions: ${resolved.join(", ")}`);
	} else if (resolved[0] !== catalog[name]) {
		violations.push(
			`bun.lock: ${name} resolves to ${resolved[0] ?? "nothing"}; expected catalog pin ${catalog[name] ?? "missing"}`,
		);
	}
}

if (violations.length > 0) {
	console.error("Dependency catalog violations:");
	for (const violation of violations) console.error(`  - ${violation}`);
	process.exit(1);
}
console.log(`check-catalog: OK (${Object.keys(catalog).length} catalog entries enforced)`);
