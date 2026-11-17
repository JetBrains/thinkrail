import {
	closeSync,
	type Dirent,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	statSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import type { WikiPage, WikiPageEntry } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

export const WIKI_OUT_DIR = "graphify-out";
export const WIKI_ENTRY = "index.md";

const MAX_PAGES = 5_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const TITLE_PROBE_BYTES = 1_024;

export function wikiRootOf(worktreePath: string): string {
	return join(worktreePath, WIKI_OUT_DIR, "wiki");
}

function headingOf(file: string): string | null {
	let fd: number;
	try {
		fd = openSync(file, "r");
	} catch {
		return null;
	}
	try {
		const buffer = Buffer.alloc(TITLE_PROBE_BYTES);
		const read = readSync(fd, buffer, 0, TITLE_PROBE_BYTES, 0);
		const match = /^#[ \t]+(.+?)[ \t]*$/m.exec(buffer.toString("utf8", 0, read));
		return match?.[1] ?? null;
	} finally {
		closeSync(fd);
	}
}

function walk(root: string): string[] {
	const found: string[] = [];
	const pending = [""];
	while (pending.length > 0 && found.length < MAX_PAGES) {
		const rel = pending.pop() as string;
		let entries: Dirent[];
		try {
			entries = readdirSync(join(root, rel), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
			if (entry.isDirectory()) pending.push(child);
			else if (entry.isFile() && entry.name.endsWith(".md")) found.push(child);
		}
	}
	return found;
}

/** The wiki's articles, entry page first, the rest by title with numbers in numeric order. */
export function listWikiPages(root: string): WikiPageEntry[] {
	const pages = walk(root).map((path) => ({
		path,
		title: headingOf(join(root, path)) ?? path.replace(/\.md$/, ""),
	}));
	pages.sort((left, right) => {
		if (left.path === WIKI_ENTRY) return -1;
		if (right.path === WIKI_ENTRY) return 1;
		return left.title.localeCompare(right.title, undefined, { numeric: true });
	});
	return pages;
}

export function wikiBuiltAt(root: string): number | undefined {
	try {
		return Math.trunc(statSync(join(root, WIKI_ENTRY)).mtimeMs);
	} catch {
		return undefined;
	}
}

function isSafeRelativePath(path: string): boolean {
	if (path === "" || path.includes("\\") || path.includes("\0") || path.startsWith("/"))
		return false;
	if (!path.endsWith(".md")) return false;
	return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

export function readWikiPage(root: string, path: string): WikiPage {
	if (!isSafeRelativePath(path))
		throw new CodedError("WIKI_NOT_BUILT", `Unknown wiki page: ${path}`);
	const absolute = resolve(root, path);
	let real: string;
	let realRoot: string;
	try {
		real = realpathSync(absolute);
		realRoot = realpathSync(root);
	} catch {
		throw new CodedError("WIKI_NOT_BUILT", `Unknown wiki page: ${path}`);
	}
	if (!real.startsWith(realRoot + sep)) {
		throw new CodedError("WIKI_NOT_BUILT", `Unknown wiki page: ${path}`);
	}
	const size = statSync(real).size;
	if (size > MAX_PAGE_BYTES) throw new CodedError("FILE_TOO_LARGE", `Wiki page too large: ${path}`);
	return { path, content: readFileSync(real, "utf8") };
}
