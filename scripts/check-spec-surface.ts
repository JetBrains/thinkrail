#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	declaredNames,
	diffSurface,
	isBareNameList,
	parseExports,
	readSurfaceBlock,
} from "./specSurface";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".turbo"]);
const root = join(import.meta.dir, "..");
const listSkipped = process.argv.includes("--list-skipped");

function specFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) specFiles(join(dir, entry.name), found);
		} else if (entry.name === "SPEC.md") {
			found.push(join(dir, entry.name));
		}
	}
	return found;
}

function barrelFor(specFile: string): string | null {
	for (const candidate of [
		join(dirname(specFile), "index.ts"),
		join(dirname(specFile), "src", "index.ts"),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function resolveTarget(fromFile: string, specifier: string): string | null {
	const base = resolve(dirname(fromFile), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

function exportedNames(barrel: string): { names: string[] } | { unresolved: string } {
	const names = new Set<string>();
	const queue = [barrel];
	const seen = new Set<string>();
	while (queue.length > 0) {
		const file = queue.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);
		const parsed = parseExports(readFileSync(file, "utf8"));
		for (const name of parsed.names) names.add(name);
		for (const specifier of parsed.starTargets) {
			if (!specifier.startsWith(".")) continue;
			const target = resolveTarget(file, specifier);
			if (target === null) return { unresolved: `${file.slice(root.length + 1)} → ${specifier}` };
			queue.push(target);
		}
	}
	return { names: [...names] };
}

const violations: string[] = [];
const skipped: { rel: string; reason: string; barrelled: boolean }[] = [];
let held = 0;

for (const specFile of specFiles(root).sort()) {
	const rel = specFile.slice(root.length + 1);
	const block = readSurfaceBlock(readFileSync(specFile, "utf8"));
	const barrel = barrelFor(specFile);
	if (block === null) {
		skipped.push({ rel, reason: "no public surface", barrelled: barrel !== null });
		continue;
	}
	if (!isBareNameList(block)) {
		skipped.push({ rel, reason: "surface written as prose", barrelled: barrel !== null });
		continue;
	}
	if (barrel === null) {
		skipped.push({ rel, reason: "no barrel to compare against", barrelled: false });
		continue;
	}
	const exported = exportedNames(barrel);
	if ("unresolved" in exported) {
		violations.push(`${rel}: a star re-export could not be resolved (${exported.unresolved})`);
		continue;
	}
	held++;
	const { promised, undeclared } = diffSurface(declaredNames(block), exported.names);
	if (promised.length > 0) {
		violations.push(
			`${rel}: names its public surface promises but the barrel no longer exports: ${promised.join(", ")}`,
		);
	}
	if (undeclared.length > 0) {
		violations.push(
			`${rel}: the barrel exports names its public surface does not list: ${undeclared.join(", ")}`,
		);
	}
}

function tally(reason: string): number {
	return skipped.filter((entry) => entry.reason === reason).length;
}

const summary = `${held} specs held; skipped: ${tally("surface written as prose")} written as prose, ${tally("no barrel to compare against")} without a barrel, ${tally("no public surface")} without a public surface`;

if (listSkipped) {
	for (const entry of skipped) console.log(`  ${entry.rel}: ${entry.reason}`);
} else {
	for (const entry of skipped.filter(
		(it) =>
			it.reason === "no barrel to compare against" ||
			(it.barrelled && it.reason === "no public surface"),
	)) {
		console.log(`  ${entry.rel}: ${entry.reason}`);
	}
}

if (violations.length > 0) {
	console.error("Spec surface drift:");
	for (const violation of violations) console.error(`  - ${violation}`);
	console.error(`\n${summary}. Run with --list-skipped to see every skipped spec.`);
	process.exit(1);
}
console.log(
	`check-spec-surface: OK (${summary}). Run with --list-skipped to see every skipped spec.`,
);
