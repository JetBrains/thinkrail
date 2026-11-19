/** What the YAML subset reads: block and flow collections, quoted and plain scalars, block scalars. */
export type YamlValue =
	| string
	| number
	| boolean
	| null
	| YamlValue[]
	| { [key: string]: YamlValue };

export class YamlError extends Error {}

interface Line {
	indent: number;
	/** The line after its indentation, comments kept (a block scalar keeps them). */
	text: string;
}

const BLANK = /^\s*(?:#.*)?$/;
const NUMBER = /^[-+]?(?:\d+|\d*\.\d+)(?:[eE][-+]?\d+)?$/;
const BLOCK_SCALAR = /^([|>])([-+]?)(\d?)([-+]?)\s*(?:#.*)?$/;

/** The text before an unquoted `#` that starts a comment (at the start or after a space). */
function stripComment(text: string): string {
	let quote: string | null = null;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (char === "\\" && quote === '"') index += 1;
			else if (char === quote) quote = null;
		} else if (char === '"' || char === "'") quote = char;
		else if (char === "#" && (index === 0 || /\s/.test(text[index - 1] ?? ""))) {
			return text.slice(0, index).trimEnd();
		}
	}
	return text.trimEnd();
}

/** Where a mapping entry's `:` sits (followed by a space or the end), outside quotes and brackets. */
function keyColon(text: string): number {
	let quote: string | null = null;
	let depth = 0;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quote) {
			if (char === "\\" && quote === '"') index += 1;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			if (index === 0) quote = char;
			continue;
		}
		if (char === "[" || char === "{") depth += 1;
		else if (char === "]" || char === "}") depth -= 1;
		else if (char === "#" && index > 0 && /\s/.test(text[index - 1] ?? "")) return -1;
		else if (char === ":" && depth === 0) {
			const next = text[index + 1];
			if (next === undefined || next === " " || next === "\t") return index;
		}
	}
	return -1;
}

function unquote(text: string): string {
	if (text.startsWith('"')) {
		if (!text.endsWith('"') || text.length < 2) throw new YamlError(`Unclosed string: ${text}`);
		try {
			return JSON.parse(text.replace(/\\\//g, "/")) as string;
		} catch {
			throw new YamlError(`Unsupported escape in ${text}`);
		}
	}
	if (!text.endsWith("'") || text.length < 2) throw new YamlError(`Unclosed string: ${text}`);
	return text.slice(1, -1).replace(/''/g, "'");
}

function plainScalar(text: string): YamlValue {
	if (/^(?:true|True|TRUE)$/.test(text)) return true;
	if (/^(?:false|False|FALSE)$/.test(text)) return false;
	if (/^(?:null|Null|NULL|~)?$/.test(text)) return null;
	if (NUMBER.test(text)) return Number(text);
	if (/^[[\]{},&*!|>%@`]/.test(text)) throw new YamlError(`Unsupported scalar: ${text}`);
	return text;
}

/** Splits a flow collection's body at its top-level commas. */
function flowItems(body: string): string[] {
	const items: string[] = [];
	let quote: string | null = null;
	let depth = 0;
	let start = 0;
	for (let index = 0; index < body.length; index += 1) {
		const char = body[index];
		if (quote) {
			if (char === "\\" && quote === '"') index += 1;
			else if (char === quote) quote = null;
		} else if (char === '"' || char === "'") quote = char;
		else if (char === "[" || char === "{") depth += 1;
		else if (char === "]" || char === "}") depth -= 1;
		else if (char === "," && depth === 0) {
			items.push(body.slice(start, index));
			start = index + 1;
		}
	}
	items.push(body.slice(start));
	return items
		.map((item) => item.trim())
		.filter((item, index, all) => item || index < all.length - 1);
}

function inline(raw: string): YamlValue {
	const text = raw.trim();
	if (text.startsWith("[")) {
		if (!text.endsWith("]")) throw new YamlError(`Unclosed flow sequence: ${text}`);
		return flowItems(text.slice(1, -1)).map(inline);
	}
	if (text.startsWith("{")) {
		if (!text.endsWith("}")) throw new YamlError(`Unclosed flow mapping: ${text}`);
		const map: Record<string, YamlValue> = {};
		for (const item of flowItems(text.slice(1, -1))) {
			const colon = keyColon(item);
			if (colon < 0) throw new YamlError(`Not a flow mapping entry: ${item}`);
			map[keyText(item.slice(0, colon))] = inline(item.slice(colon + 1));
		}
		return map;
	}
	if (text.startsWith('"') || text.startsWith("'")) return unquote(text);
	return plainScalar(text);
}

function keyText(raw: string): string {
	const key = raw.trim();
	return key.startsWith('"') || key.startsWith("'") ? unquote(key) : key;
}

const balanced = (text: string) => {
	let depth = 0;
	for (const char of text) {
		if (char === "[" || char === "{") depth += 1;
		else if (char === "]" || char === "}") depth -= 1;
	}
	return depth <= 0;
};

class Reader {
	private index = 0;
	private readonly lines: Line[];

	constructor(text: string) {
		this.lines = text
			.replace(/^\uFEFF/, "")
			.replace(/\r\n?/g, "\n")
			.split("\n")
			.map((line) => {
				const indent = line.length - line.replace(/^ +/, "").length;
				return { indent, text: line.slice(indent) };
			});
		const first = this.lines.findIndex((line) => !BLANK.test(line.text));
		if (first >= 0 && /^---(?:\s|$)/.test(this.lines[first]?.text ?? "")) {
			const rest = (this.lines[first]?.text ?? "").slice(3).trim();
			if (rest && !rest.startsWith("#")) throw new YamlError("Content on the document marker.");
			this.index = first + 1;
		}
	}

	private next(): Line | undefined {
		while (this.index < this.lines.length) {
			const line = this.lines[this.index];
			if (!line) break;
			if (/^(?:\.\.\.|---)(?:\s|$)/.test(line.text) && line.indent === 0) {
				this.index = this.lines.length;
				return undefined;
			}
			if (!BLANK.test(line.text)) return line;
			this.index += 1;
		}
		return undefined;
	}

	document(): YamlValue {
		const line = this.next();
		if (!line) return null;
		const value = this.node(line.indent);
		if (this.next()) throw new YamlError("Unexpected content after the document.");
		return value;
	}

	private node(indent: number): YamlValue {
		const line = this.next();
		if (!line || line.indent < indent) return null;
		if (/^-(?:\s|$)/.test(line.text)) return this.sequence(line.indent);
		if (keyColon(stripComment(line.text)) >= 0) return this.mapping(line.indent);
		this.index += 1;
		return this.flow(stripComment(line.text), line.indent);
	}

	/** An inline value, joined over the following lines while its brackets stay open. */
	private flow(text: string, indent: number): YamlValue {
		let joined = text;
		while (!balanced(joined)) {
			const line = this.lines[this.index];
			if (!line || (line.indent <= indent && !BLANK.test(line.text)))
				throw new YamlError(`Unclosed flow collection: ${text}`);
			joined += ` ${stripComment(line.text)}`;
			this.index += 1;
		}
		return inline(joined);
	}

	private blockScalar(header: RegExpExecArray, parent: number): string {
		const folded = header[1] === ">";
		const chomp = header[2] || header[4];
		const lines: string[] = [];
		let block = header[3] ? parent + Number(header[3]) : -1;
		while (this.index < this.lines.length) {
			const line = this.lines[this.index];
			if (!line) break;
			const empty = !line.text.trim();
			if (!empty && line.indent <= parent) break;
			if (!empty && block < 0) block = line.indent;
			lines.push(empty ? "" : `${" ".repeat(Math.max(0, line.indent - block))}${line.text}`);
			this.index += 1;
		}
		while (lines.length > 0 && chomp !== "+" && lines.at(-1) === "") lines.pop();
		const body = folded
			? lines.reduce((text, line, index) => {
					if (index === 0) return line;
					const previous = lines[index - 1] ?? "";
					return text + (line === "" || previous === "" || /^\s/.test(line) ? "\n" : " ") + line;
				}, "")
			: lines.join("\n");
		if (chomp === "-" || body === "") return body;
		return `${body}\n`;
	}

	private value(rest: string, indent: number): YamlValue {
		const scalar = BLOCK_SCALAR.exec(rest.trimStart());
		if (scalar) return this.blockScalar(scalar, indent);
		const text = stripComment(rest);
		if (text) return this.flow(text, indent);
		const next = this.next();
		if (!next) return null;
		if (next.indent > indent) return this.node(next.indent);
		if (next.indent === indent && /^-(?:\s|$)/.test(next.text)) return this.sequence(indent);
		return null;
	}

	private mapping(indent: number): Record<string, YamlValue> {
		const map: Record<string, YamlValue> = {};
		for (;;) {
			const line = this.next();
			if (!line || line.indent < indent) return map;
			if (line.indent > indent) throw new YamlError(`Bad indentation: ${line.text}`);
			const colon = keyColon(line.text);
			if (colon < 0 || /^-(?:\s|$)/.test(line.text)) {
				if (/^-(?:\s|$)/.test(line.text)) return map;
				throw new YamlError(`Not a mapping entry: ${line.text}`);
			}
			const key = keyText(line.text.slice(0, colon));
			this.index += 1;
			map[key] = this.value(line.text.slice(colon + 1), indent);
		}
	}

	private sequence(indent: number): YamlValue[] {
		const items: YamlValue[] = [];
		for (;;) {
			const line = this.next();
			if (!line || line.indent !== indent || !/^-(?:\s|$)/.test(line.text)) return items;
			const rest = line.text.slice(1);
			const content = rest.trimStart();
			if (!stripComment(content) && !BLOCK_SCALAR.test(content)) {
				this.index += 1;
				items.push(this.value("", indent));
				continue;
			}
			const column = indent + 1 + (rest.length - content.length);
			if (!/^[[{"']/.test(content) && keyColon(stripComment(content)) >= 0) {
				this.lines[this.index] = { indent: column, text: content };
				items.push(this.mapping(column));
				continue;
			}
			this.index += 1;
			items.push(this.value(content, indent));
		}
	}
}

/** Reads one YAML document of the subset OpenSpec's files use; throws `YamlError` on anything else. */
export function parseYaml(text: string): YamlValue {
	return new Reader(text).document();
}

export const isYamlMap = (value: unknown): value is Record<string, YamlValue> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const PLAIN_SAFE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const PLAIN_SPECIAL = /^(?:true|false|null|yes|no|on|off|y|n|~)$/i;

/** A scalar written plain when it reads back as the same string, else double-quoted. */
export function yamlScalar(value: string): string {
	return PLAIN_SAFE.test(value) && !PLAIN_SPECIAL.test(value) && !NUMBER.test(value)
		? value
		: JSON.stringify(value);
}

/**
 * Sets one top-level key to a mapping of strings, editing only that key's lines: the entry is replaced in
 * place (its indented and same-column `- ` lines included), else appended. Every other line — keys,
 * comments, blank lines, the line endings — stays as written.
 */
export function upsertTopLevelKey(
	text: string,
	key: string,
	value: Readonly<Record<string, string>>,
): string {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const block = [
		`${key}:`,
		...Object.entries(value).map(([name, entry]) => `  ${name}: ${yamlScalar(entry)}`),
	];
	const lines = text.split(/\r?\n/);
	const trailing = lines.at(-1) === "";
	if (trailing) lines.pop();
	const escaped = key.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
	const head = new RegExp(`^(?:${escaped}|"${escaped}"|'${escaped}')\\s*:(?:\\s|$)`);
	const start = lines.findIndex((line) => head.test(line));
	if (start < 0) {
		const end = lines.findIndex((line) => /^\.\.\.(?:\s|$)/.test(line));
		const at = end < 0 ? lines.length : end;
		lines.splice(at, 0, ...block);
	} else {
		let last = start;
		for (let index = start + 1; index < lines.length; index += 1) {
			const line = lines[index] ?? "";
			if (!line.trim()) continue;
			if (/^[ \t]/.test(line) || /^-(?:\s|$)/.test(line)) last = index;
			else break;
		}
		lines.splice(start, last - start + 1, ...block);
	}
	return `${lines.join(eol)}${eol}`;
}
