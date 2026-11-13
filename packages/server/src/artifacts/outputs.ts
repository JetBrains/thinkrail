import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
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
const MAX_OUTPUT_WALK_ENTRIES = 20_000;
const LIST_TIMEOUT_MS = 10_000;
const MTIME_SLACK_MS = 1_000;

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

async function walk(
	abs: string,
	visit: (path: string, entry: Dirent) => Promise<boolean> | boolean,
): Promise<boolean> {
	const queue = [abs];
	let seen = 0;
	for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (++seen > MAX_OUTPUT_WALK_ENTRIES) return false;
			if (entry.isDirectory() && DEPENDENCY_AND_CACHE_DIRS.has(entry.name)) continue;
			const path = join(dir, entry.name);
			if (!(await visit(path, entry))) return true;
			if (entry.isDirectory()) queue.push(path);
		}
	}
	return true;
}

async function modifiedSince(path: string, since: number): Promise<boolean> {
	const stat = await lstat(path).catch(() => undefined);
	return stat !== undefined && stat.mtimeMs >= since - MTIME_SLACK_MS;
}

export async function outputChangedSince(
	abs: string,
	kind: OutputKind,
	since: number,
): Promise<boolean> {
	if (await modifiedSince(abs, since)) return true;
	if (kind === "file") return false;
	let changed = false;
	await walk(abs, async (path) => {
		changed = await modifiedSince(path, since);
		return !changed;
	});
	return changed;
}

export async function countOutputFiles(
	abs: string,
	kind: OutputKind,
): Promise<{ files: number; truncated: boolean }> {
	if (kind === "file") return { files: 1, truncated: false };
	let files = 0;
	const complete = await walk(abs, (_path, entry) => {
		if (entry.isFile()) files += 1;
		return true;
	});
	return { files, truncated: !complete };
}
