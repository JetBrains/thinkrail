import { Document, isMap, isScalar, isSeq, parseDocument, parse as parseYaml } from "yaml";

export type FrontmatterValue = string | string[];

export type Frontmatter = Record<string, FrontmatterValue>;

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

export const REQUIRED_FIELDS = [FIELDS.id, FIELDS.type, FIELDS.title] as const;

export const IDENTITY_FIELDS = [FIELDS.id, FIELDS.type] as const;

export const SPEC_TYPES = [
	"goal-and-requirements",
	"architecture-design",
	"module-design",
	"submodule-design",
	"task-spec",
] as const;

export type SpecType = (typeof SPEC_TYPES)[number];

export const SPEC_STATUSES = ["draft", "active", "stale", "done", "deprecated"] as const;

export type SpecStatus = (typeof SPEC_STATUSES)[number];

export const SINGLE_LINK_FIELDS = [FIELDS.parent] as const;

export const LIST_LINK_FIELDS = [FIELDS.dependsOn, FIELDS.references, FIELDS.implements] as const;

export const LIST_FIELDS = [...LIST_LINK_FIELDS, FIELDS.covers, FIELDS.tags] as const;

export const FIELD_ORDER = [
	FIELDS.id,
	FIELDS.type,
	FIELDS.status,
	FIELDS.title,
	...SINGLE_LINK_FIELDS,
	...LIST_FIELDS,
] as const;

export type LinkKind = (typeof SINGLE_LINK_FIELDS)[number] | (typeof LIST_LINK_FIELDS)[number];

const FENCE = "---";
const BOM = "\ufeff";
const CRLF = "\r\n";
const TO_STRING = { lineWidth: 0, flowCollectionPadding: false } as const;

function lineEnding(text: string): string {
	const first = text.indexOf("\n");
	return first > 0 && text[first - 1] === "\r" ? CRLF : "\n";
}

export interface ParsedFile {
	frontmatter: Frontmatter | null;
	body: string;
}

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
	}
	return fm;
}

function splitFrontmatter(content: string): { fmText: string | null; body: string } {
	const normalized = content.startsWith(BOM) ? content.slice(1) : content;
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

export function scalar(fm: Frontmatter, key: string): string | undefined {
	const value = fm[key];
	if (typeof value === "string" && value !== "") return value;
	return undefined;
}

export function list(fm: Frontmatter, key: string): string[] {
	const value = fm[key];
	if (Array.isArray(value)) return value;
	if (typeof value === "string" && value !== "") return [value];
	return [];
}

export function isSpec(fm: Frontmatter | null): fm is Frontmatter {
	return fm !== null && IDENTITY_FIELDS.every((field) => scalar(fm, field) !== undefined);
}

function inlineLists(doc: Document): void {
	if (isMap(doc.contents)) {
		for (const pair of doc.contents.items) if (isSeq(pair.value)) pair.value.flow = true;
	}
}

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

function docScalar(doc: Document, key: string): string | undefined {
	const node = doc.get(key, true);
	return isScalar(node) && node.value != null && node.value !== "" ? String(node.value) : undefined;
}

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

export interface FrontmatterEdit {
	set?: Record<string, string> | undefined;
	remove?: readonly string[] | undefined;
	addList?: Readonly<Partial<Record<string, string[]>>> | undefined;
	removeList?: Readonly<Partial<Record<string, string[]>>> | undefined;
}

export type FrontmatterEditResult = { content: string } | { error: string };

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

	if (IDENTITY_FIELDS.some((field) => docScalar(doc, field) === undefined)) {
		return { error: "Update would leave the file without a valid id and type." };
	}

	inlineLists(doc);
	const block = `${FENCE}\n${doc.toString(TO_STRING)}${FENCE}\n`;
	const rewritten = lineEnding(fileText) === CRLF ? block.replace(/\n/g, CRLF) : block;
	return { content: `${fileText.startsWith(BOM) ? BOM : ""}${rewritten}${body}` };
}
