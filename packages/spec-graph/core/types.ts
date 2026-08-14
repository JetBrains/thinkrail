// The spec-type model: type cards and the registry that resolves them. A type card is one markdown
// file — human-first prose plus a small machine-readable frontmatter core — defining what a kind of
// spec is for and what it should contain (the skills model, applied to specs). Pi-free.
//
// Card frontmatter is parsed as FULL YAML by this module's own reader (cards may carry nested maps,
// e.g. `links`), never `parse.ts`'s lossy spec dialect. Cards carry no `id`/`type`, so the spec index
// never mistakes them for specs — and the registry never influences graph construction (see
// core/SPEC.md invariants).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { BUILTIN_SPEC_TYPE_CARDS } from "./builtins.ts";
import { splitFrontmatter } from "./parse.ts";

/** The durable/ephemeral axis every type declares (durable = ground truth; ephemeral = serves a piece of work). */
export const SPEC_LIFECYCLES = ["durable", "ephemeral"] as const;

/** A type's lifecycle (see {@link SPEC_LIFECYCLES}). */
export type SpecLifecycle = (typeof SPEC_LIFECYCLES)[number];

/** Where a resolved card came from — the registry's precedence layers, highest first. */
export const TYPE_CARD_ORIGINS = ["project", "user", "builtin"] as const;

/** A card's origin layer (see {@link TYPE_CARD_ORIGINS}). */
export type TypeCardOrigin = (typeof TYPE_CARD_ORIGINS)[number];

/** A parsed type card: the machine-readable core plus the prose body the agent reads before authoring. */
export interface SpecTypeCard {
	/** The slug specs put in `type`; the registry's precedence key. */
	name: string;
	/** Display name; falls back to {@link name}. */
	title: string;
	/** 1–2 sentences: what the type is for and when to choose it — the choose-signal. */
	description: string;
	/** Durable (ground truth) or ephemeral (serves a piece of work). Defaults to durable. */
	lifecycle: SpecLifecycle;
	/** Default location hint (a dir or pattern). A default, never enforced. */
	home: string | undefined;
	/** Expected top-level headings — the `spec_create` scaffold and the advisory-validation hook. */
	sections: string[];
	/** Extra frontmatter fields specs of this type should carry. */
	fields: string[];
	/** Status vocabulary for this type; empty = the global `SPEC_STATUSES` applies. */
	statuses: string[];
	/** Expectations over the built-in link kinds (e.g. `parent: module-design`). Never new edge kinds. */
	links: Record<string, string>;
	/** The `## Template` block's content (fence interior when fenced), if the body carries one. */
	template: string | undefined;
	/** The prose body (when to use, quality bar, template). */
	body: string;
}

/** A registry entry: the card plus where it was resolved from. */
export interface ResolvedTypeCard extends SpecTypeCard {
	origin: TypeCardOrigin;
	/** Absolute file path for project/user cards; undefined for built-ins (embedded, no file). */
	path: string | undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((v) => typeof v === "string" && v !== "");
	const s = asString(value);
	return s === undefined ? [] : [s];
}

function asStringRecord(value: unknown): Record<string, string> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		const s = asString(v);
		if (s !== undefined) out[k] = s;
	}
	return out;
}

/**
 * Extract the `## Template` block from a card body: everything after the heading up to the next `## `
 * heading. When that span carries a fenced code block, the fence interior is the template (so cards can
 * show markdown templates without the headings registering as the card's own); otherwise the trimmed
 * span. Undefined when absent or empty.
 */
function extractTemplate(body: string): string | undefined {
	const lines = body.split("\n");
	const start = lines.findIndex((l) => /^##\s+Template\s*$/.test(l.trim()));
	if (start === -1) return undefined;
	// Fence-aware span scan: a heading inside a fenced block belongs to the template, not the card.
	let inFence = false;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (!inFence && /^##\s+/.test(line)) {
			end = i;
			break;
		}
	}
	const span = lines.slice(start + 1, end);
	const open = span.findIndex((l) => /^\s*```/.test(l));
	if (open !== -1) {
		const close = span.findIndex((l, i) => i > open && /^\s*```\s*$/.test(l));
		const interior = span
			.slice(open + 1, close === -1 ? span.length : close)
			.join("\n")
			.trim();
		return interior === "" ? undefined : `${interior}\n`;
	}
	const raw = span.join("\n").trim();
	return raw === "" ? undefined : `${raw}\n`;
}

/**
 * Parse a file's text as a type card. The is-a-card rule: frontmatter carrying non-empty `name` and
 * `description`. Returns null for anything else (including YAML errors) — a bad file in a registry dir
 * is skipped, never fatal. `lifecycle` defaults to durable; unknown lifecycle values coerce to durable
 * (the safe default consumers inherit).
 */
export function parseTypeCard(content: string): SpecTypeCard | null {
	const { fmText, body } = splitFrontmatter(content);
	if (fmText === null) return null;
	let loaded: unknown;
	try {
		loaded = parseYaml(fmText);
	} catch {
		return null;
	}
	if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) return null;
	const fm = loaded as Record<string, unknown>;
	const name = asString(fm.name);
	const description = asString(fm.description);
	if (name === undefined || description === undefined) return null;
	const lifecycle: SpecLifecycle = fm.lifecycle === "ephemeral" ? "ephemeral" : "durable";
	return {
		name,
		title: asString(fm.title) ?? name,
		description,
		lifecycle,
		home: asString(fm.home),
		sections: asStringArray(fm.sections),
		fields: asStringArray(fm.fields),
		statuses: asStringArray(fm.statuses),
		links: asStringRecord(fm.links),
		template: extractTemplate(body),
		body,
	};
}

/** A cached per-file card parse, valid while the file's (mtimeMs, size) is unchanged. */
interface CardCacheEntry {
	mtimeMs: number;
	size: number;
	/** Parsed card, or null when the file isn't a card (cached either way, to skip re-parsing). */
	card: SpecTypeCard | null;
}

/** The built-ins, parsed once per process (the embedded texts are constants). */
let builtinCache: ResolvedTypeCard[] | null = null;

/** The built-in cards, in canonical order. */
export function builtinTypeCards(): readonly ResolvedTypeCard[] {
	if (builtinCache === null) {
		builtinCache = BUILTIN_SPEC_TYPE_CARDS.flatMap((text) => {
			const card = parseTypeCard(text);
			return card === null ? [] : [{ ...card, origin: "builtin" as const, path: undefined }];
		});
	}
	return builtinCache;
}

/** An additional registry layer: a directory of cards and the origin label its cards resolve with. */
export interface TypeCardDir {
	dir: string;
	origin: Exclude<TypeCardOrigin, "builtin">;
}

/**
 * The spec-type registry for one spec root. Resolves cards across precedence layers — the project's
 * `.pi/spec-types/*.md`, any extra dirs (the user layer), then the built-ins — highest layer wins on
 * `name`. Like `SpecIndex`, a derived read model: every read rescans the dirs (flat, `*.md`) and
 * revalidates per file by (mtimeMs, size), so cards added/edited/removed from any source are current on
 * the next call, while unchanged files skip re-parsing.
 */
export class SpecTypeRegistry {
	private readonly dirs: readonly TypeCardDir[];
	/** Per-file parse cache, keyed by absolute path. */
	private readonly cache = new Map<string, CardCacheEntry>();
	/** Memoized resolved list; dropped whenever a scan observes any change. */
	private resolved: ResolvedTypeCard[] | null = null;

	constructor(root: string, opts?: { extraDirs?: readonly TypeCardDir[] }) {
		this.dirs = [
			{ dir: join(root, ".pi", "spec-types"), origin: "project" },
			...(opts?.extraDirs ?? []),
		];
	}

	/** Scan one layer dir, returning its cards by file (sorted by filename for determinism). */
	private scanDir(layer: TypeCardDir, out: Map<string, ResolvedTypeCard>, seen: Set<string>): void {
		let names: string[];
		try {
			names = readdirSync(layer.dir)
				.filter((n) => n.endsWith(".md"))
				.sort();
		} catch {
			return; // No dir → empty layer.
		}
		for (const fileName of names) {
			const abs = join(layer.dir, fileName);
			seen.add(abs);
			let stat: import("node:fs").Stats;
			try {
				stat = statSync(abs);
			} catch {
				continue;
			}
			if (!stat.isFile()) continue;
			let entry = this.cache.get(abs);
			if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
				let card: SpecTypeCard | null = null;
				try {
					card = parseTypeCard(readFileSync(abs, "utf8"));
				} catch {
					// Unreadable → treated as not-a-card.
				}
				entry = { mtimeMs: stat.mtimeMs, size: stat.size, card };
				this.cache.set(abs, entry);
				this.resolved = null;
			}
			const card = entry.card;
			// First card seen for a name wins within and across layers (layers scan highest-first).
			if (card !== null && !out.has(card.name)) {
				out.set(card.name, { ...card, origin: layer.origin, path: abs });
			}
		}
	}

	/**
	 * The resolved cards: built-ins in canonical order (each replaced by a higher-layer override when
	 * one exists), then custom-only cards sorted by name.
	 */
	cards(): ResolvedTypeCard[] {
		const fromDirs = new Map<string, ResolvedTypeCard>();
		const seen = new Set<string>();
		for (const layer of this.dirs) this.scanDir(layer, fromDirs, seen);
		for (const abs of [...this.cache.keys()]) {
			if (!seen.has(abs)) {
				this.cache.delete(abs);
				this.resolved = null;
			}
		}
		if (this.resolved === null) {
			const builtins = builtinTypeCards();
			const ordered: ResolvedTypeCard[] = builtins.map((b) => fromDirs.get(b.name) ?? b);
			const builtinNames = new Set(builtins.map((b) => b.name));
			const custom = [...fromDirs.values()]
				.filter((c) => !builtinNames.has(c.name))
				.sort((a, b) => a.name.localeCompare(b.name));
			this.resolved = [...ordered, ...custom];
		}
		return this.resolved;
	}

	/** The resolved card for a type name, or undefined when unregistered. */
	get(name: string): ResolvedTypeCard | undefined {
		return this.cards().find((c) => c.name === name);
	}

	/** A type's lifecycle. Unknown types are durable — the safe default (see core/SPEC.md). */
	lifecycleOf(type: string): SpecLifecycle {
		return this.get(type)?.lifecycle ?? "durable";
	}
}
