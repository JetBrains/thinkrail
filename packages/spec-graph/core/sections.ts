import { parseFile } from "./parse.ts";

export interface SpecSection {
	readonly headings: readonly string[];
	readonly line: number;
	readonly endLine: number;
	readonly body: readonly string[];
	readonly bodyLine: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_MARKER = /^ {0,3}(?:[-*+]|(\d{1,9})[.)])(?= |$)/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const BLOCK_QUOTE = /^ {0,3}> ?/;
const TAB_STOP = 4;

const HTML_BLOCK_NAMES =
	"address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const HTML_STARTS: readonly { readonly start: RegExp; readonly end: RegExp | null }[] = [
	{
		start: /^<(?:pre|script|style|textarea)(?=[ \t>]|$)/i,
		end: /<\/(?:pre|script|style|textarea)>/i,
	},
	{ start: /^<!--/, end: /-->/ },
	{ start: /^<\?/, end: /\?>/ },
	{ start: /^<![A-Za-z]/, end: />/ },
	{ start: /^<!\[CDATA\[/, end: /\]\]>/ },
	{ start: new RegExp(`^</?(?:${HTML_BLOCK_NAMES})(?=[ \\t>]|/>|$)`, "i"), end: null },
];
const HTML_ATTRIBUTE =
	"[ \\t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \\t]*=[ \\t]*(?:[^ \\t\"'=<>`/]+|'[^']*'|\"[^\"]*\"))?";
const HTML_COMPLETE_TAG = new RegExp(
	`^(?:<[A-Za-z][A-Za-z0-9-]*(?:${HTML_ATTRIBUTE})*[ \\t]*/?>|</[A-Za-z][A-Za-z0-9-]*[ \\t]*>)[ \\t]*$`,
);

export function cleanInline(text: string): string {
	return text
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/`+/g, "")
		.replace(/\*\*|__/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function closesFence(line: string, open: string): boolean {
	const match = FENCE.exec(line);
	const marker = match?.[1];
	return (
		marker !== undefined &&
		marker[0] === open[0] &&
		marker.length >= open.length &&
		line.slice((match?.index ?? 0) + (match?.[0].length ?? 0)).trim() === ""
	);
}

interface Heading {
	readonly index: number;
	readonly level: number;
	readonly text: string;
}

interface ListItem {
	readonly indent: number;
	opensBlank: boolean;
	blankSince: boolean;
}

type Container = "quote" | ListItem;
type HtmlEnd = RegExp | "blank";

function fenceMarker(text: string): string | null {
	const match = FENCE.exec(text);
	const marker = match?.[1];
	if (!match || marker === undefined) return null;
	if (marker[0] === "`" && text.slice(match[0].length).includes("`")) return null;
	return marker;
}

function htmlStart(text: string, inParagraph: boolean): HtmlEnd | "closed" | null {
	const indent = indentOf(text);
	if (indent > 3 || text[indent] !== "<") return null;
	const tag = text.slice(indent);
	const html = HTML_STARTS.find(({ start }) => start.test(tag));
	if (html) return html.end?.test(tag) ? "closed" : (html.end ?? "blank");
	return !inParagraph && HTML_COMPLETE_TAG.test(tag) ? "blank" : null;
}

function listItemWidth(text: string, inParagraph: boolean): number {
	const match = LIST_MARKER.exec(text);
	if (!match) return 0;
	const after = text.slice(match[0].length);
	const empty = after.trim() === "";
	if (inParagraph && (empty || (match[1] !== undefined && match[1] !== "1"))) return 0;
	const spaces = indentOf(after);
	return match[0].length + (empty || spaces > TAB_STOP ? 1 : spaces);
}

function interruptsParagraph(text: string): boolean {
	return (
		fenceMarker(text) !== null ||
		htmlStart(text, true) !== null ||
		ATX_HEADING.test(text) ||
		THEMATIC_BREAK.test(text) ||
		BLOCK_QUOTE.test(text) ||
		listItemWidth(text, false) > 0
	);
}

function expandTabs(line: string): string {
	if (!line.includes("\t")) return line;
	let expanded = "";
	for (const char of line) {
		expanded += char === "\t" ? " ".repeat(TAB_STOP - (expanded.length % TAB_STOP)) : char;
	}
	return expanded;
}

function indentOf(line: string): number {
	const content = line.search(/[^ ]/);
	return content === -1 ? line.length : content;
}

function continued(line: string, containers: readonly Container[]): [number, string] {
	let rest = line;
	let matched = 0;
	for (const container of containers) {
		if (container === "quote") {
			const quote = BLOCK_QUOTE.exec(rest);
			if (!quote) break;
			rest = rest.slice(quote[0].length);
		} else if (rest.trim() === "") {
			container.blankSince ||= container.opensBlank;
			rest = "";
		} else {
			const held = !container.blankSince && indentOf(rest) >= container.indent;
			container.opensBlank = false;
			container.blankSince = false;
			if (!held) break;
			rest = rest.slice(container.indent);
		}
		matched += 1;
	}
	return [matched, rest];
}

function headingsOf(lines: readonly string[], from: number): Heading[] {
	const headings: Heading[] = [];
	const containers: Container[] = [];
	let fence: string | null = null;
	let html: HtmlEnd | null = null;
	let paragraph = false;
	let code = false;
	for (let index = from; index < lines.length; index += 1) {
		let [matched, rest] = continued(expandTabs(lines[index] ?? ""), containers);
		const blank = rest.trim() === "";
		const inside = matched === containers.length;
		if (fence !== null) {
			if (inside) {
				if (closesFence(rest, fence)) fence = null;
				continue;
			}
			fence = null;
		}
		if (html !== null) {
			if (inside && !(blank && html === "blank")) {
				if (html !== "blank" && html.test(rest)) html = null;
				continue;
			}
			html = null;
		}
		if (blank) {
			containers.length = matched;
			paragraph = false;
			if (!inside) code = false;
			continue;
		}
		if (!inside) {
			if (paragraph && !interruptsParagraph(rest)) {
				if (htmlStart(rest, false) !== null) {
					html = "blank";
					paragraph = false;
				}
				continue;
			}
			containers.length = matched;
			paragraph = false;
			code = false;
		}
		let interrupting = paragraph || code;
		let inParagraph: boolean = paragraph;
		paragraph = false;
		code = false;
		while (!THEMATIC_BREAK.test(rest)) {
			const quote = BLOCK_QUOTE.exec(rest);
			const width = quote ? quote[0].length : listItemWidth(rest, interrupting);
			if (width === 0) break;
			rest = rest.slice(width);
			containers.push(
				quote ? "quote" : { indent: width, opensBlank: rest.trim() === "", blankSince: false },
			);
			interrupting = false;
			inParagraph = false;
		}
		if (rest.trim() === "" || THEMATIC_BREAK.test(rest)) continue;
		if (!inParagraph && indentOf(rest) >= TAB_STOP) {
			code = inside || containers.length > matched;
			continue;
		}
		fence = fenceMarker(rest);
		if (fence !== null) continue;
		const block = htmlStart(rest, inParagraph);
		if (block !== null) {
			if (block !== "closed") html = block;
			continue;
		}
		const heading = ATX_HEADING.exec(rest);
		if (heading) {
			headings.push({
				index,
				level: heading[1]?.length ?? 1,
				text: cleanInline(heading[2] ?? ""),
			});
			continue;
		}
		paragraph = !(inParagraph && SETEXT_UNDERLINE.test(rest));
	}
	return headings;
}

export function splitSections(content: string): SpecSection[] {
	const lines = (content.startsWith("\ufeff") ? content.slice(1) : content)
		.split("\n")
		.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	const from = lines.length - parseFile(content).body.split("\n").length;
	const headings = headingsOf(lines, from);
	const titled =
		headings[0]?.level === 1 && headings.filter((heading) => heading.level === 1).length === 1;
	const sections: SpecSection[] = [];
	const push = (trail: readonly string[], start: number, bodyStart: number, end: number) => {
		const body = lines.slice(bodyStart, end);
		if (trail.length === 0 && body.every((line) => line.trim() === "")) return;
		sections.push({
			headings: trail,
			line: start + 1,
			endLine: end,
			body,
			bodyLine: bodyStart + 1,
		});
	};
	push([], from, from, headings[0]?.index ?? lines.length);
	const trail: Heading[] = [];
	headings.forEach((heading, at) => {
		const end = headings[at + 1]?.index ?? lines.length;
		if (titled && at === 0) {
			push([], heading.index, heading.index + 1, end);
			return;
		}
		while ((trail[trail.length - 1]?.level ?? 0) >= heading.level) trail.pop();
		trail.push(heading);
		push(
			trail.map((entry) => entry.text),
			heading.index,
			heading.index + 1,
			end,
		);
	});
	return sections;
}
