import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { OpenspecTree } from "./parse";

/** The recorded fixtures (`scripts/record-openspec-fixtures.ts`), for tests. */
export const FIXTURES = join(import.meta.dir, "fixtures");

/** A fixture's `openspec/**` markdown and YAML, as the host's `openspecTree` fact reads it. */
export function fixtureTree(name: string): OpenspecTree {
	const root = join(FIXTURES, name);
	const files: { path: string; text: string }[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (/\.(?:md|ya?ml)$/.test(entry.name))
				files.push({ path: relative(root, path), text: readFileSync(path, "utf8") });
		}
	};
	walk(join(root, "openspec"));
	return { files: files.sort((a, b) => (a.path < b.path ? -1 : 1)) };
}

/** A recorded file of a fixture (`list.json`, `show/<change>.json`, …). */
export function recorded(name: string, file: string): string {
	return readFileSync(join(FIXTURES, name, file), "utf8");
}
