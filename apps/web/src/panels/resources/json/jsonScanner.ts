import type { ReviewAnchor } from "@thinkrail/contracts";
import type { AnchorDraft, ReviewThread } from "@/resources";

export type JsonNodeType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonNode {
	pointer: string;
	key?: string;
	type: JsonNodeType;
	value: unknown;
	startLine: number;
	endLine: number;
	children: JsonNode[];
}

export type JsonDialect = "json" | "jsonc";

export interface JsonDocument {
	value: unknown;
	root: JsonNode;
	nodes: ReadonlyMap<string, JsonNode>;
	dialect: JsonDialect;
}

interface ParsedValue {
	type: JsonNodeType;
	value: unknown;
	children: JsonNode[];
	end: number;
}

function escapePointerSegment(segment: string): string {
	return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

class JsonScanner {
	private index = 0;
	private dialect: JsonDialect = "json";
	private readonly nodes = new Map<string, JsonNode>();
	private readonly lineStarts = [0];

	constructor(private readonly text: string) {
		for (let index = 0; index < text.length; index += 1) {
			if (text.charCodeAt(index) === 10) this.lineStarts.push(index + 1);
		}
	}

	scan(): JsonDocument {
		this.skipTrivia();
		const root = this.parseNode("");
		this.skipTrivia();
		if (this.index !== this.text.length) throw new Error("Unexpected content after JSON value");
		return { value: root.value, root, nodes: this.nodes, dialect: this.dialect };
	}

	private lineAt(offset: number): number {
		let low = 0;
		let high = this.lineStarts.length;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if ((this.lineStarts[middle] ?? 0) <= offset) low = middle + 1;
			else high = middle;
		}
		return Math.max(1, low);
	}

	private skipTrivia(): void {
		for (;;) {
			while (/\s/.test(this.text[this.index] ?? "")) this.index += 1;
			if (this.text.startsWith("//", this.index)) {
				this.dialect = "jsonc";
				this.index += 2;
				while (this.index < this.text.length && this.text[this.index] !== "\n") this.index += 1;
				continue;
			}
			if (this.text.startsWith("/*", this.index)) {
				this.dialect = "jsonc";
				const end = this.text.indexOf("*/", this.index + 2);
				if (end < 0) throw new Error("Unterminated JSON comment");
				this.index = end + 2;
				continue;
			}
			return;
		}
	}

	private parseString(): { value: string; start: number; end: number } {
		const start = this.index;
		if (this.text[this.index] !== '"') throw new Error("Expected JSON string");
		this.index += 1;
		let escaped = false;
		while (this.index < this.text.length) {
			const char = this.text[this.index] ?? "";
			if (!escaped && char === '"') {
				this.index += 1;
				const raw = this.text.slice(start, this.index);
				return { value: JSON.parse(raw) as string, start, end: this.index };
			}
			if (!escaped && (char === "\n" || char === "\r")) {
				throw new Error("Line break in JSON string");
			}
			if (!escaped && char === "\\") escaped = true;
			else escaped = false;
			this.index += 1;
		}
		throw new Error("Unterminated JSON string");
	}

	private parseNode(pointer: string, key?: string, propertyStart?: number): JsonNode {
		this.skipTrivia();
		const valueStart = this.index;
		const parsed = this.parseValue(pointer);
		const start = propertyStart ?? valueStart;
		const node: JsonNode = {
			pointer,
			...(key === undefined ? {} : { key }),
			type: parsed.type,
			value: parsed.value,
			startLine: this.lineAt(start),
			endLine: this.lineAt(Math.max(start, parsed.end - 1)),
			children: parsed.children,
		};
		this.nodes.set(pointer, node);
		return node;
	}

	private parseValue(pointer: string): ParsedValue {
		const char = this.text[this.index];
		if (char === "{") return this.parseObject(pointer);
		if (char === "[") return this.parseArray(pointer);
		if (char === '"') {
			const token = this.parseString();
			return { type: "string", value: token.value, children: [], end: token.end };
		}
		if (this.text.startsWith("true", this.index)) {
			this.index += 4;
			return { type: "boolean", value: true, children: [], end: this.index };
		}
		if (this.text.startsWith("false", this.index)) {
			this.index += 5;
			return { type: "boolean", value: false, children: [], end: this.index };
		}
		if (this.text.startsWith("null", this.index)) {
			this.index += 4;
			return { type: "null", value: null, children: [], end: this.index };
		}
		const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
			this.text.slice(this.index),
		)?.[0];
		if (number) {
			this.index += number.length;
			return { type: "number", value: Number(number), children: [], end: this.index };
		}
		throw new Error("Expected JSON value");
	}

	private parseObject(pointer: string): ParsedValue {
		this.index += 1;
		const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		const children: JsonNode[] = [];
		const childIndex = new Map<string, number>();
		this.skipTrivia();
		if (this.text[this.index] === "}") {
			this.index += 1;
			return { type: "object", value, children, end: this.index };
		}
		for (;;) {
			this.skipTrivia();
			const key = this.parseString();
			this.skipTrivia();
			if (this.text[this.index] !== ":") throw new Error("Expected colon after JSON key");
			this.index += 1;
			const childPointer = `${pointer}/${escapePointerSegment(key.value)}`;
			const duplicateIndex = childIndex.get(key.value);
			if (duplicateIndex !== undefined) {
				for (const storedPointer of [...this.nodes.keys()]) {
					if (storedPointer === childPointer || storedPointer.startsWith(`${childPointer}/`)) {
						this.nodes.delete(storedPointer);
					}
				}
			}
			const child = this.parseNode(childPointer, key.value, key.start);
			value[key.value] = child.value;
			if (duplicateIndex === undefined) {
				childIndex.set(key.value, children.length);
				children.push(child);
			} else {
				children[duplicateIndex] = child;
			}
			this.skipTrivia();
			const separator = this.text[this.index];
			if (separator === "}") {
				this.index += 1;
				return { type: "object", value, children, end: this.index };
			}
			if (separator !== ",") throw new Error("Expected comma between JSON properties");
			this.index += 1;
			this.skipTrivia();
			if (this.text[this.index] === "}") {
				this.dialect = "jsonc";
				this.index += 1;
				return { type: "object", value, children, end: this.index };
			}
		}
	}

	private parseArray(pointer: string): ParsedValue {
		this.index += 1;
		const value: unknown[] = [];
		const children: JsonNode[] = [];
		this.skipTrivia();
		if (this.text[this.index] === "]") {
			this.index += 1;
			return { type: "array", value, children, end: this.index };
		}
		for (;;) {
			const childPointer = `${pointer}/${children.length}`;
			const child = this.parseNode(childPointer);
			children.push(child);
			value.push(child.value);
			this.skipTrivia();
			const separator = this.text[this.index];
			if (separator === "]") {
				this.index += 1;
				return { type: "array", value, children, end: this.index };
			}
			if (separator !== ",") throw new Error("Expected comma between JSON items");
			this.index += 1;
			this.skipTrivia();
			if (this.text[this.index] === "]") {
				this.dialect = "jsonc";
				this.index += 1;
				return { type: "array", value, children, end: this.index };
			}
		}
	}
}

export function scanJson(text: string): JsonDocument | null {
	try {
		return new JsonScanner(text).scan();
	} catch {
		return null;
	}
}

export function jsonNodeDraft(node: JsonNode): AnchorDraft | null {
	if (node.pointer.length === 0) return null;
	return {
		selectors: [
			{ kind: "lineRange", startLine: node.startLine, endLine: node.endLine },
			{ kind: "structural", scheme: "json-pointer", ref: node.pointer },
		],
		label: node.pointer,
	};
}

export function jsonNodeOfAnchor(anchor: ReviewAnchor, document: JsonDocument): JsonNode | null {
	const selector = anchor.selectors.find(
		(candidate) => candidate.kind === "structural" && candidate.scheme === "json-pointer",
	);
	if (selector?.kind !== "structural") return null;
	const node = document.nodes.get(selector.ref);
	if (!node) return null;
	const lines = anchor.selectors.find((candidate) => candidate.kind === "lineRange");
	if (
		lines?.kind === "lineRange" &&
		(node.endLine < lines.startLine || node.startLine > lines.endLine)
	) {
		return null;
	}
	return node;
}

export function placedJsonThreadIds(
	threads: readonly ReviewThread[],
	document: JsonDocument,
): ReadonlySet<string> {
	return new Set(
		threads.flatMap((thread) => (jsonNodeOfAnchor(thread.anchor, document) ? [thread.id] : [])),
	);
}

export function jsonPrimitiveLabel(value: unknown): string {
	return typeof value === "string" ? JSON.stringify(value) : String(value);
}
