import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionOpenspecTree, ExtensionTextFile } from "../extensions";

export const OPENSPEC_DIR = "openspec";
export const OPENSPEC_TREE_MAX_BYTES = 2 * 1024 * 1024;
export const OPENSPEC_TREE_MAX_FILES = 2_000;
const OPENSPEC_TREE_MAX_DEPTH = 16;
const TEXT_FILE = /\.(?:md|yaml|yml)$/;

/**
 * A worktree's `openspec/` markdown and YAML files, sorted by path: symlinks (the folder itself included)
 * are never followed, and the read stops at `maxBytes` or `maxFiles`, saying it was `truncated`; `null`
 * without a plain `openspec/` folder.
 */
export async function readOpenspecTree(
	worktree: string,
	limits: { maxBytes: number; maxFiles: number } = {
		maxBytes: OPENSPEC_TREE_MAX_BYTES,
		maxFiles: OPENSPEC_TREE_MAX_FILES,
	},
): Promise<ExtensionOpenspecTree | null> {
	const root = join(worktree, OPENSPEC_DIR);
	const stat = await lstat(root).catch(() => null);
	if (!stat?.isDirectory()) return null;
	const files: ExtensionTextFile[] = [];
	let bytes = 0;
	let truncated = false;
	const walk = async (dir: string, relative: string, depth: number): Promise<void> => {
		if (depth > OPENSPEC_TREE_MAX_DEPTH) return;
		const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
		);
		for (const entry of entries) {
			if (truncated) return;
			if (entry.isSymbolicLink() || entry.name === ".git") continue;
			const path = join(dir, entry.name);
			const shown = `${relative}/${entry.name}`;
			if (entry.isDirectory()) await walk(path, shown, depth + 1);
			else if (entry.isFile() && TEXT_FILE.test(entry.name)) {
				const info = await lstat(path).catch(() => null);
				if (!info?.isFile()) continue;
				if (bytes + info.size > limits.maxBytes || files.length >= limits.maxFiles) {
					truncated = true;
					return;
				}
				const text = await readFile(path, "utf8").catch(() => null);
				if (text === null) continue;
				bytes += info.size;
				files.push({ path: shown, text });
			}
		}
	};
	await walk(root, OPENSPEC_DIR, 0);
	return truncated ? { files, truncated: true } : { files };
}
