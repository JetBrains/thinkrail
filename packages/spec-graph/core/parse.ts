// Frontmatter parse/serialize + the is-a-spec rule. Pi-free: no @earendil-works/* imports.
//
// We split the leading `---` fence ourselves and hand the block to the `yaml` library (the parser `pi`
// uses) so quoting/escaping/edge cases are its problem. Reads coerce to a scalar/string-array dialect
// (lossy, fine for the read model). Edits go through `updateFrontmatterText`, which mutates a live
// Document in place — untouched fields, their order, comments, and nested values are preserved.

import { Document, isMap, isScalar, isSeq, parseDocument, parse as parseYaml } from "yaml";

/** A frontmatter value is a scalar string or an inline string array. */
export type FrontmatterValue = string | string[];

/** Parsed frontmatter: field name -> value, insertion order preserved. */
export type Frontmatter = Record<string, FrontmatterValue>;

/**
 * The canonical frontmatter field names — the single source of truth for every schema field key. The
 * tuples below derive from it, so renaming a field is a one-line change here. `scalar`/`list` stay
 * generic (they must tolerate unknown on-disk fields); schema call sites reference `FIELDS.*`.
 */
export const FIELDS = {
	id: "id",
	type: "type",
	status: "status",
	title: "title",
	parent: "parent",
	dependsOn: "depends-on",
	references: "references",
	implements: "implements",
	covers: "covers",
	tags: "tags",
} as const;

/** Schema-required fields (every spec should carry these). The is-a-spec rule is narrower: `id` + `type`. */
export const REQUIRED_FIELDS = [FIELDS.id, FIELDS.type, FIELDS.title] as const;

/** The identity fields the is-a-spec rule requires; `spec_update` protects these from removal/blanking. */
export const IDENTITY_FIELDS = [FIELDS.id, FIELDS.type] as const;

/**
 * The spec `type` values the extension can author (used by `spec_create`). The read model does *not*
 * enforce this set — on-disk files may carry any `type` and are still indexed — so it's an authoring
 * vocabulary, not a validation gate.
 */
export const SPEC_TYPES = [
	"goal-and-requirements",
	"architecture-design",
	"module-design",
	"submodule-design",
	"task-spec",
] as const;

/** A spec `type` the extension can author (see {@link SPEC_TYPES}). */
export type SpecType = (typeof SPEC_TYPES)[number];

/** The `status` lifecycle values the extension can author. Optional and unenforced, like {@link SPEC_TYPES}. */
export const SPEC_STATUSES = ["draft", "active", "stale", "done", "deprecated"] as const;

/** A spec `status` the extension can author (see {@link SPEC_STATUSES}). */
export type SpecStatus = (typeof SPEC_STATUSES)[number];

/** Single-valued link field (the parent tree). */
export const SINGLE_LINK_FIELDS = [FIELDS.parent] as const;

/** List-valued link fields (the DAG). */
export const LIST_LINK_FIELDS = [FIELDS.dependsOn, FIELDS.references, FIELDS.implements] as const;

/** All list-valued fields: the DAG link lists plus the metadata lists. */
export const LIST_FIELDS = [...LIST_LINK_FIELDS, FIELDS.covers, FIELDS.tags] as const;

/** Canonical field order `spec_create` builds new frontmatter in (edits preserve a file's own order). */
export const FIELD_ORDER = [
	FIELDS.id,
	FIELDS.type,
	FIELDS.status,
	FIELDS.title,
	...SINGLE_LINK_FIELDS,
	...LIST_FIELDS,
] as const;

/** The directed link kinds: the single-valued parent edge plus the DAG link lists. */
export type LinkKind = (typeof SINGLE_LINK_FIELDS)[number] | (typeof LIST_LINK_FIELDS)[number];

const FENCE = "---";
const TO_STRING = { lineWidth: 0, flowCollectionPadding: false } as const;

/** Result of splitting a file into its frontmatter and the prose body. */
export interface ParsedFile {
	/** Parsed frontmatter, or null when the file has no leading fence / no valid mapping there. */
	frontmatter: Frontmatter | null;
	/** Everything after the closing fence (or the whole file when there is no fence). */
	body: string;
}

/** Coerce parsed YAML into the frontmatter dialect (scalars + string arrays). A non-mapping yields null. */
function toFrontmatter(loaded: unknown): Frontmatter | null {
	if (loaded === null || loaded === undefined) return {};
	if (typeof loaded !== "object" || Array.isArray(loaded)) return null;
	const fm: Frontmatter = {};
	for (const [key, value] of Object.entries(loaded as Record<string, unknown>)) {
		if (value === null || value === undefined) continue;
		if (Array.isArray(value)) {
			fm[key] = value.filter((v) => v !== null && v !== undefined).map((v) => String(v));
		} else if (typeof value !== "object") {
			fm[key] = String(value);
		}
		// Nested maps fall outside the read dialect and are dropped here (the write path preserves them).
	}
	return fm;
}

/**
 * Split a file into its frontmatter YAML text and prose body. A trailing `\r` is stripped from each
 * fence-interior line so CRLF-authored files parse cleanly: the `yaml` lib normalizes interior `\r\n`
 * breaks, but the final line's `\r` has no following `\n` and would otherwise corrupt the last scalar or
 * make a flow list throw. Without a leading/closing fence, `fmText` is null and `body` is the whole file.
 */
function splitFrontmatter(content: string): { fmText: string | null; body: string } {
	const normalized = content.startsWith("\ufeff") ? content.slice(1) : content;
	const lines = normalized.split("\n");
	if (lines[0]?.trim() !== FENCE) return { fmText: null, body: content };
	let end = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === FENCE) {
			end = i;
			break;
		}
	}
	if (end === -1) return { fmText: null, body: content };
	const body = lines.slice(end + 1).join("\n");
	const fmText = lines
		.slice(1, end)
		.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
		.join("\n");
	return { fmText, body };
}

/**
 * Split a file into `{ frontmatter, body }`. `frontmatter` is null without a valid fenced mapping. Lossy
 * by design (values coerced to the dialect) — fine for reads; edits use {@link updateFrontmatterText}.
 */
export function parseFile(content: string): ParsedFile {
	const { fmText, body } = splitFrontmatter(content);
	if (fmText === null) return { frontmatter: null, body };
	let loaded: unknown;
	try {
		loaded = parseYaml(fmText);
	} catch {
		return { frontmatter: null, body: content };
	}
	return { frontmatter: toFrontmatter(loaded), body };
}

/** Read a scalar field as a string, or undefined when absent/non-scalar/empty. */
export function scalar(fm: Frontmatter, key: string): string | undefined {
	const value = fm[key];
	if (typeof value === "string" && value !== "") return value;
	return undefined;
}

/** Read a field as a string array, coercing a lone scalar to a one-element array. */
export function list(fm: Frontmatter, key: string): string[] {
	const value = fm[key];
	if (Array.isArray(value)) return value;
	if (typeof value === "string" && value !== "") return [value];
	return [];
}

/** The is-a-spec rule: frontmatter carrying non-empty {@link IDENTITY_FIELDS} (`id` and `type`). */
export function isSpec(fm: Frontmatter | null): fm is Frontmatter {
	return fm !== null && IDENTITY_FIELDS.every((field) => scalar(fm, field) !== undefined);
}

/** Force top-level list values inline (flow), leaving the mapping itself block-style. */
function inlineLists(doc: Document): void {
	if (isMap(doc.contents)) {
		for (const pair of doc.contents.items) if (isSeq(pair.value)) pair.value.flow = true;
	}
}

/**
 * Serialize a plain frontmatter object into a `---`-fenced block, in the object's own key order, with
 * lists inline and empty scalars/arrays dropped. Used by `spec_create` (built from scratch, in
 * {@link FIELD_ORDER}); in-place edits use {@link updateFrontmatterText}.
 */
export function serializeFrontmatter(fm: Frontmatter): string {
	const clean: Frontmatter = {};
	for (const [key, value] of Object.entries(fm)) {
		if (Array.isArray(value)) {
			if (value.length > 0) clean[key] = value;
		} else if (value !== "") {
			clean[key] = value;
		}
	}
	if (Object.keys(clean).length === 0) return `${FENCE}\n${FENCE}\n`;
	const doc = new Document(clean);
	inlineLists(doc);
	return `${FENCE}\n${doc.toString(TO_STRING)}${FENCE}\n`;
}

/** Read a scalar field off a Document map as a non-empty string, else undefined. */
function docScalar(doc: Document, key: string): string | undefined {
	const node = doc.get(key, true);
	return isScalar(node) && node.value != null && node.value !== "" ? String(node.value) : undefined;
}

/** Read a list field off a Document map as a string array (a lone scalar coerces to one element). */
function docList(doc: Document, key: string): string[] {
	const node = doc.get(key, true);
	if (isSeq(node)) {
		return node.items
			.map((item) => (isScalar(item) ? item.value : item))
			.filter((v) => v != null)
			.map((v) => String(v));
	}
	return isScalar(node) && node.value != null && node.value !== "" ? [String(node.value)] : [];
}

/** A frontmatter-only edit: scalar sets, field removals, and add/remove across the list fields. */
export interface FrontmatterEdit {
	/** Scalar fields to set/overwrite (never a list field — route those through addList/removeList). */
	set?: Record<string, string> | undefined;
	/** Field names to remove entirely (never a protected identity field). */
	remove?: readonly string[] | undefined;
	/** List fields to append to (deduped against existing entries), keyed by field name. */
	addList?: Readonly<Partial<Record<string, string[]>>> | undefined;
	/** List fields to prune from (the field is dropped when it empties), keyed by field name. */
	removeList?: Readonly<Partial<Record<string, string[]>>> | undefined;
}

/** The outcome of {@link updateFrontmatterText}: the rewritten file, or a message the model can act on. */
export type FrontmatterEditResult = { content: string } | { error: string };

/**
 * Apply a frontmatter-only {@link FrontmatterEdit} to a file's text and return the rewritten file. The
 * frontmatter is parsed as a live `yaml` Document and mutated in place, so untouched fields keep their
 * order and any comments/nested values survive; the prose body is untouched. Enforces the never-un-spec
 * rule (no removing/blanking/renaming `id`/`type`), routes list fields through add/remove (rejecting
 * `set` on them), and writes the file back in its original line ending (LF or CRLF).
 */
export function updateFrontmatterText(
	fileText: string,
	edit: FrontmatterEdit,
): FrontmatterEditResult {
	const { fmText, body } = splitFrontmatter(fileText);
	if (fmText === null) return { error: "File has no frontmatter to update." };
	let doc: Document;
	try {
		doc = parseDocument(fmText);
	} catch {
		return { error: "File frontmatter is not valid YAML." };
	}
	if (doc.errors.length > 0 || !isMap(doc.contents)) {
		return { error: "File frontmatter is not valid YAML." };
	}

	for (const [key, value] of Object.entries(edit.set ?? {})) {
		if (key === FIELDS.id) return { error: "Cannot rename a spec's id via set." };
		if ((LIST_FIELDS as readonly string[]).includes(key)) {
			return { error: `Use addList/removeList to edit the list field "${key}".` };
		}
		doc.set(key, value);
	}
	for (const key of edit.remove ?? []) {
		if ((IDENTITY_FIELDS as readonly string[]).includes(key)) {
			return { error: `Cannot remove protected field "${key}".` };
		}
		doc.delete(key);
	}
	for (const field of LIST_FIELDS) {
		const add = edit.addList?.[field];
		if (add?.length) doc.set(field, doc.createNode([...new Set([...docList(doc, field), ...add])]));
		const remove = edit.removeList?.[field];
		if (remove?.length) {
			const next = docList(doc, field).filter((v) => !remove.includes(v));
			if (next.length) doc.set(field, doc.createNode(next));
			else doc.delete(field);
		}
	}

	// Never un-spec: the edit must leave a non-empty id and type.
	if (IDENTITY_FIELDS.some((field) => docScalar(doc, field) === undefined)) {
		return { error: "Update would leave the file without a valid id and type." };
	}

	inlineLists(doc);
	const out = `${FENCE}\n${doc.toString(TO_STRING)}${FENCE}\n${body}`;
	// Restore the source's line ending (write CRLF back over a CRLF file; LF otherwise).
	return { content: fileText.includes("\r\n") ? out.replace(/\r?\n/g, "\r\n") : out };
}
