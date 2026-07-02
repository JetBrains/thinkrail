// The derived read model: in-memory, read-only, revalidated on demand. The filesystem is the source of
// truth — every read re-globs the spec set (ignoring node_modules/.git/dist/build) and revalidates each
// file by (mtimeMs, size): unchanged files reuse their cached parse, changed/new files are re-read and
// re-parsed, and vanished files are evicted. The derived graph is memoized and rebuilt only when the
// spec set actually changed. So added, deleted, and externally-edited specs (including prose written
// with pi's normal write/edit) are always current, with no staleness window — but redundant reads,
// parses, and graph rebuilds are skipped when nothing moved. Pi-free — uses only node built-ins.
//
// Freshness rests on (mtimeMs, size): the one theoretical miss is an edit that lands within the same
// mtime tick AND keeps the byte length identical — negligible in practice (real edits change size or
// cross a tick). A content hash is the sanctioned escalation for bulletproof freshness; a watcher used
// as a dirty-flag is the escalation if the tree walk itself ever dominates (see core/SPEC.md).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { buildGraph, type SpecGraph } from "./graph.ts";
import { FIELDS, type Frontmatter, isSpec, parseFile, scalar } from "./parse.ts";
import type { SpecContentEntry } from "./query.ts";

/** Directories never descended into while globbing for specs. */
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

/** One spec file surfaced to callers: its paths, text, and parsed frontmatter. */
export interface SpecFileRecord {
	/** Absolute path. */
	abs: string;
	/** Root-relative path (POSIX-style separators). */
	rel: string;
	content: string;
	frontmatter: Frontmatter;
}

/** A cached per-file parse, valid while the file's (mtimeMs, size) is unchanged. */
interface CacheEntry {
	rel: string;
	mtimeMs: number;
	size: number;
	/** The file's text — retained only for specs (grep + `spec_update` read it); `""` for non-specs. */
	content: string;
	/** Parsed frontmatter, or null when the file carries none (cached either way, to skip re-parsing). */
	frontmatter: Frontmatter | null;
}

function toRel(root: string, abs: string): string {
	return relative(root, abs).split(sep).join("/");
}

/**
 * The spec index for a single root directory. Holds a per-file parse cache keyed by absolute path and
 * validated by (mtimeMs, size), plus a memoized derived graph. It re-walks the tree on every call, so it
 * always sees the current filesystem (adds/deletes included), but skips re-reading/re-parsing unchanged
 * files and skips rebuilding an unchanged graph. One is reused per root (keyed by cwd by the tools
 * layer) — that reuse is what lets the cache pay off across an agent's tool calls.
 */
export class SpecIndex {
	private readonly root: string;
	/** Per-file parse cache, keyed by absolute path, validated by (mtimeMs, size). */
	private readonly cache = new Map<string, CacheEntry>();
	/** Memoized derived graph; dropped (set null) whenever a scan observes any change. */
	private graphCache: SpecGraph | null = null;

	constructor(root: string) {
		this.root = root;
	}

	/** Resolve a root-relative path to an absolute one. */
	absPath(rel: string): string {
		return join(this.root, rel);
	}

	/** Walk the tree, yielding absolute paths of every `.md` file (ignoring the standard dirs). */
	private *walk(dir: string): Generator<string> {
		let dirents: import("node:fs").Dirent[];
		try {
			dirents = readdirSync(dir, { withFileTypes: true }) as import("node:fs").Dirent[];
		} catch {
			return;
		}
		for (const dirent of dirents) {
			const abs = join(dir, dirent.name);
			if (dirent.isDirectory()) {
				if (IGNORED_DIRS.has(dirent.name)) continue;
				yield* this.walk(abs);
			} else if (dirent.isFile() && dirent.name.endsWith(".md")) {
				yield abs;
			}
		}
	}

	/**
	 * Rescan the tree, revalidating the per-file cache by (mtimeMs, size): unchanged files reuse their
	 * cached parse, changed/new files are re-read + re-parsed, and files that vanished since the last
	 * scan are evicted. Drops the memoized graph iff anything changed. Returns the current spec files
	 * (non-specs skipped), in walk order (so the "first file seen wins" duplicate rule is stable).
	 */
	private scan(): SpecFileRecord[] {
		const seen = new Set<string>();
		const specs: SpecFileRecord[] = [];
		let changed = false;

		for (const abs of this.walk(this.root)) {
			seen.add(abs);
			let stat: import("node:fs").Stats;
			try {
				stat = statSync(abs);
			} catch {
				continue;
			}
			let entry = this.cache.get(abs);
			if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
				let content: string;
				try {
					content = readFileSync(abs, "utf8");
				} catch {
					// Unreadable now: drop any stale cache entry and skip.
					if (this.cache.delete(abs)) changed = true;
					continue;
				}
				const { frontmatter } = parseFile(content);
				entry = {
					rel: toRel(this.root, abs),
					mtimeMs: stat.mtimeMs,
					size: stat.size,
					// Keep the text only for specs; a non-spec still caches its (mtime,size)+null frontmatter
					// so we skip re-parsing it, but drops its (possibly large) body from memory.
					content: isSpec(frontmatter) ? content : "",
					frontmatter,
				};
				this.cache.set(abs, entry);
				changed = true;
			}
			const fm = entry.frontmatter;
			if (isSpec(fm)) {
				specs.push({ abs, rel: entry.rel, content: entry.content, frontmatter: fm });
			}
		}

		// Evict cache entries for files that disappeared since the last scan.
		for (const abs of [...this.cache.keys()]) {
			if (!seen.has(abs)) {
				this.cache.delete(abs);
				changed = true;
			}
		}

		if (changed) this.graphCache = null;
		return specs;
	}

	/** The derived graph, rebuilt only when the spec set changed since the last call (else memoized). */
	graph(): SpecGraph {
		const specs = this.scan();
		if (this.graphCache === null) {
			this.graphCache = buildGraph(specs.map((r) => ({ path: r.rel, frontmatter: r.frontmatter })));
		}
		return this.graphCache;
	}

	/** Spec files with their text loaded, for content grep. */
	contentEntries(): SpecContentEntry[] {
		return this.scan().map((r) => ({
			path: r.rel,
			content: r.content,
			frontmatter: r.frontmatter,
		}));
	}

	/**
	 * The cached record for an id — root-relative + absolute path, the scanned text, and parsed
	 * frontmatter — or undefined when unknown (first file seen wins). A caller that also needs the file's
	 * text (e.g. `spec_update`) uses this to work off the scan's cached read instead of a second one.
	 */
	recordForId(id: string): SpecFileRecord | undefined {
		return this.scan().find((r) => scalar(r.frontmatter, FIELDS.id) === id);
	}

	/** The node's root-relative path for an id, or undefined when unknown (first file seen wins). */
	pathForId(id: string): string | undefined {
		return this.recordForId(id)?.rel;
	}
}
