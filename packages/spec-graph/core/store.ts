import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { buildGraph, type SpecGraph } from "./graph.ts";
import { FIELDS, type Frontmatter, isSpec, parseFile, scalar } from "./parse.ts";
import type { SpecContentEntry } from "./query.ts";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build"]);

export const SPEC_FILE_EXTENSION = ".md";

function isSymlink(target: string): boolean {
	try {
		return lstatSync(target).isSymbolicLink();
	} catch {
		return false;
	}
}

export type SpecPathResolution = { rel: string; abs: string } | { error: string };

export function resolveSpecPath(root: string, path: string): SpecPathResolution {
	if (path.trim() === "") return { error: "Path must not be empty." };
	if (isAbsolute(path)) return { error: `Path must be root-relative, not absolute: ${path}` };
	if (!path.endsWith(SPEC_FILE_EXTENSION)) {
		return { error: `Spec files must end in ${SPEC_FILE_EXTENSION}: ${path}` };
	}

	const lexical = normalize(path);
	const segments = lexical.split(sep);
	if (segments[0] === "..") return { error: `Path must stay inside the project root: ${path}` };
	const ignored = segments.find((segment) => IGNORED_DIRS.has(segment));
	if (ignored !== undefined) {
		return {
			error: `Path is inside an ignored directory ("${ignored}") and would not be indexed: ${path}`,
		};
	}
	if (!existsSync(root)) return { error: `Project root does not exist: ${root}` };

	let walked = root;
	for (const segment of segments) {
		walked = join(walked, segment);
		if (isSymlink(walked)) {
			return { error: `Path passes through a symlink, which the index never follows: ${path}` };
		}
	}

	return { rel: lexical.split(sep).join("/"), abs: join(root, lexical) };
}

export interface SpecFileRecord {
	abs: string;
	rel: string;
	content: string;
	frontmatter: Frontmatter;
}

interface CacheEntry {
	rel: string;
	mtimeMs: number;
	size: number;
	content: string;
	frontmatter: Frontmatter | null;
}

function toRel(root: string, abs: string): string {
	return relative(root, abs).split(sep).join("/");
}

export class SpecIndex {
	private readonly root: string;
	private readonly cache = new Map<string, CacheEntry>();
	private graphCache: SpecGraph | null = null;

	constructor(root: string) {
		this.root = root;
	}

	absPath(rel: string): string {
		return join(this.root, rel);
	}

	private *walk(dir: string): Generator<string> {
		let dirents: import("node:fs").Dirent[];
		try {
			dirents = readdirSync(dir, { withFileTypes: true }) as import("node:fs").Dirent[];
		} catch {
			return;
		}
		const order = new Map(dirents.map((d) => [d.name, d.name.normalize("NFC")]));
		dirents.sort((a, b) => {
			const left = order.get(a.name) ?? a.name;
			const right = order.get(b.name) ?? b.name;
			return left < right ? -1 : left > right ? 1 : 0;
		});
		for (const dirent of dirents) {
			const abs = join(dir, dirent.name);
			if (dirent.isDirectory()) {
				if (IGNORED_DIRS.has(dirent.name)) continue;
				yield* this.walk(abs);
			} else if (dirent.isFile() && dirent.name.endsWith(SPEC_FILE_EXTENSION)) {
				yield abs;
			}
		}
	}

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
					if (this.cache.delete(abs)) changed = true;
					continue;
				}
				const { frontmatter } = parseFile(content);
				entry = {
					rel: toRel(this.root, abs),
					mtimeMs: stat.mtimeMs,
					size: stat.size,
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

		for (const abs of [...this.cache.keys()]) {
			if (!seen.has(abs)) {
				this.cache.delete(abs);
				changed = true;
			}
		}

		if (changed) this.graphCache = null;
		return specs;
	}

	graph(): SpecGraph {
		const specs = this.scan();
		if (this.graphCache === null) {
			this.graphCache = buildGraph(specs.map((r) => ({ path: r.rel, frontmatter: r.frontmatter })));
		}
		return this.graphCache;
	}

	contentEntries(): SpecContentEntry[] {
		return this.scan().map((r) => ({
			path: r.rel,
			content: r.content,
			frontmatter: r.frontmatter,
		}));
	}

	recordForId(id: string): SpecFileRecord | undefined {
		return this.scan().find((r) => scalar(r.frontmatter, FIELDS.id) === id);
	}

	pathForId(id: string): string | undefined {
		return this.recordForId(id)?.rel;
	}
}
