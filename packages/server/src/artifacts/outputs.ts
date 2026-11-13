import { type Dirent, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gitAsync } from "../git";

export const DEPENDENCY_AND_CACHE_DIRS: ReadonlySet<string> = new Set([
	".git",
	".thinkrail",
	"node_modules",
	"bower_components",
	".pnpm-store",
	".yarn",
	".venv",
	"venv",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
	".tox",
	".gradle",
	".turbo",
	".cache",
]);

const MAX_ROOTS = 5_000;
export const MAX_OUTPUT_WALK_ENTRIES = 20_000;
const LIST_TIMEOUT_MS = 10_000;

export type OutputKind = "file" | "dir";

function denied(path: string): boolean {
	return path.split("/").some((segment) => DEPENDENCY_AND_CACHE_DIRS.has(segment));
}

export function collapseIgnoredEntries(entries: readonly string[]): Map<string, OutputKind> {
	const dirs = new Set(entries.filter((entry) => entry.endsWith("/")).map((e) => e.slice(0, -1)));
	const roots = new Map<string, OutputKind>();
	for (const entry of [...entries].sort()) {
		const kind: OutputKind = entry.endsWith("/") ? "dir" : "file";
		const path = kind === "dir" ? entry.slice(0, -1) : entry;
		if (!path || denied(path)) continue;
		const parts = path.split("/");
		let nested = false;
		for (let depth = 1; depth < parts.length && !nested; depth++) {
			nested = dirs.has(parts.slice(0, depth).join("/"));
		}
		if (nested) continue;
		roots.set(path, kind);
		if (roots.size >= MAX_ROOTS) break;
	}
	return roots;
}

export async function listIgnoredRoots(root: string): Promise<Map<string, OutputKind> | null> {
	const result = await gitAsync(
		root,
		["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
		{ timeoutMs: LIST_TIMEOUT_MS, raw: true },
	);
	if (!result.ok) return null;
	return collapseIgnoredEntries(result.out.split("\0").filter(Boolean));
}

function walk(abs: string, visit: (path: string, entry: Dirent) => boolean): boolean {
	const queue = [abs];
	let seen = 0;
	for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (++seen > MAX_OUTPUT_WALK_ENTRIES) return false;
			if (entry.isDirectory() && DEPENDENCY_AND_CACHE_DIRS.has(entry.name)) continue;
			const path = join(dir, entry.name);
			if (!visit(path, entry)) return true;
			if (entry.isDirectory()) queue.push(path);
		}
	}
	return true;
}

function modifiedSince(path: string, since: number): boolean {
	const stat = lstatSync(path, { throwIfNoEntry: false });
	return stat !== undefined && stat.mtimeMs >= since;
}

export function outputChangedSince(abs: string, kind: OutputKind, since: number): boolean {
	if (modifiedSince(abs, since)) return true;
	if (kind === "file") return false;
	let changed = false;
	walk(abs, (path) => {
		changed = modifiedSince(path, since);
		return !changed;
	});
	return changed;
}

export function countOutputFiles(
	abs: string,
	kind: OutputKind,
): { files: number; truncated: boolean } {
	if (kind === "file") return { files: 1, truncated: false };
	let files = 0;
	const complete = walk(abs, (_path, entry) => {
		if (entry.isFile()) files += 1;
		return true;
	});
	return { files, truncated: !complete };
}
