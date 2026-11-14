import { Lexer, type Token } from "marked";

interface MarkdownBlock {
	start: number;
	raw: string;
	closed: boolean;
}

export interface MarkdownSplit {
	text: string;
	blocks: readonly MarkdownBlock[];
	whole: boolean;
	tentative: boolean;
}

const FOOTNOTE_DEFINITION = /^(?:[\t >]|[-+*][\t ]|\d{1,9}[.)][\t ])*\[\^(?:[^\]\n\\]|\\.)+\]:/m;
const BLANK_LINE_END = /\n[\t ]*\n$/;
const TRAILING_WHITESPACE_LINES = /\n[\t \n]*$/;
const ATX_HEADING = /^ {0,3}#/;
const CONTAINER_PREFIX = /^[\t >]*(?:(?:[-+*]|\d{1,9}[.)])(?:[\t ]+|$))?/;
const HTML_START = /^[\t >]*<(\?|!\[CDATA\[|!--|![A-Za-z])/;
const HTML_ENDS: Readonly<Record<string, string>> = { "?": "?>", "![CDATA[": "]]>", "!--": "-->" };
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[\t ]*$/;
const HTML_LINE = /^[\t >]*<[A-Za-z/!?]/m;
const OPENING_TAG = /<([A-Za-z][\w:-]*)[\s>/]/;
const VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

interface OpenHtml {
	tag: string;
	depth: number;
}

function wholeSplit(text: string, tentative: boolean): MarkdownSplit {
	return {
		text,
		blocks: text ? [{ start: 0, raw: text, closed: false }] : [],
		whole: true,
		tentative,
	};
}

function countTags(raw: string, tag: string) {
	const opens = raw.match(new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, "gi")) ?? [];
	const closes = raw.match(new RegExp(`</${tag}(?=[\\s>])[^>]*>`, "gi")) ?? [];
	const selfClosing = opens.filter((open) => open.trimEnd().endsWith("/>")).length;
	return opens.length - selfClosing - closes.length;
}

function trackHtml(open: OpenHtml | null, token: Token): OpenHtml | null {
	if (open) {
		const depth = open.depth + countTags(token.raw, open.tag);
		return depth > 0 ? { tag: open.tag, depth } : null;
	}
	if (token.type !== "html" || !token.block) return null;
	const tag = OPENING_TAG.exec(token.raw)?.[1]?.toLowerCase();
	if (!tag || VOID_TAGS.has(tag)) return null;
	const depth = countTags(token.raw, tag);
	return depth > 0 ? { tag, depth } : null;
}

function isIndentedCode(token: Token | undefined) {
	return token?.type === "code" && token.codeBlockStyle === "indented";
}

function isFence(token: Token) {
	return token.type === "code" && token.codeBlockStyle !== "indented";
}

function closesFence(open: string, line: string) {
	const close = CLOSING_FENCE.exec(line)?.[1];
	return !!close && close[0] === open[0] && close.length >= open.length;
}

function isClosedFence(token: Token) {
	if (!isFence(token)) return false;
	const lines = token.raw.replace(/\n+$/, "").split("\n");
	const open = FENCE.exec(lines[0] ?? "")?.[1];
	if (!open || lines.length < 2 || !closesFence(open, lines.at(-1) ?? "")) return false;
	return !lines.slice(1, -1).some((line) => closesFence(open, line));
}

function hasOpenNestedFence(token: Token) {
	if (token.type !== "list" && token.type !== "blockquote") return false;
	let open: string | undefined;
	for (const line of token.raw.split("\n")) {
		const content = line.replace(CONTAINER_PREFIX, "").trimStart();
		if (open) {
			if (closesFence(open, content)) open = undefined;
		} else open = FENCE.exec(content)?.[1];
	}
	return open !== undefined;
}

function pendingHtmlEnd(pending: string | null, token: Token) {
	if (token.type === "code") return pending;
	let end = pending;
	for (const line of token.raw.split("\n")) {
		if (end) {
			if (line.includes(end)) end = null;
			continue;
		}
		const start = HTML_START.exec(line);
		if (!start?.[1]) continue;
		const marker = HTML_ENDS[start[1]] ?? ">";
		if (!line.slice(start[0].length).includes(marker)) end = marker;
	}
	return end;
}

function endsBlock(token: Token) {
	return (
		(token.type === "heading" && ATX_HEADING.test(token.raw)) ||
		token.type === "hr" ||
		isClosedFence(token)
	);
}

interface SplitState {
	previous: Token | undefined;
	html: OpenHtml | null;
	afterInterruptedList: boolean;
	htmlLine: boolean;
	openFence: boolean;
	nestedFence: boolean;
	htmlEnd: string | null;
	tail: string;
}

function isContinued(state: SplitState) {
	return (
		state.html !== null ||
		state.afterInterruptedList ||
		state.openFence ||
		state.nestedFence ||
		state.htmlEnd !== null
	);
}

function joins(block: MarkdownBlock, state: SplitState, raw: string, next?: Token) {
	return (
		isContinued(state) ||
		raw.trim() === "" ||
		block.raw.trim() === "" ||
		!block.closed ||
		(state.previous?.type === "html" && !BLANK_LINE_END.test(state.previous.raw)) ||
		isIndentedCode(state.previous) ||
		isIndentedCode(next)
	);
}

function nextState(state: SplitState, token: Token, joined: boolean, end: string): SplitState {
	const blank = BLANK_LINE_END.test(end);
	const interrupts =
		joined && state.previous?.type === "list" && token.type !== "space" && token.type !== "list";
	return {
		previous: token,
		html: trackHtml(state.html, token),
		afterInterruptedList: interrupts || (state.afterInterruptedList && token.raw.trim() === ""),
		htmlLine: !blank && (state.htmlLine || (!isFence(token) && HTML_LINE.test(token.raw))),
		openFence: state.openFence || (isFence(token) && !isClosedFence(token)),
		nestedFence: hasOpenNestedFence(token) || (state.nestedFence && token.raw.trim() === ""),
		htmlEnd: pendingHtmlEnd(state.htmlEnd, token),
		tail: TRAILING_WHITESPACE_LINES.exec(end)?.[0] ?? "",
	};
}

function isClosed(wasClosed: boolean, state: SplitState) {
	if (isContinued(state)) return false;
	if (BLANK_LINE_END.test(state.tail)) return true;
	const token = state.previous;
	if (state.htmlLine || !token) return false;
	return token.raw.trim() === "" ? wasClosed : endsBlock(token);
}

function toBlocks(text: string, from: number, tokens: readonly Token[]) {
	const blocks: MarkdownBlock[] = [];
	let offset = from;
	let state: SplitState = {
		previous: undefined,
		html: null,
		afterInterruptedList: false,
		htmlLine: false,
		openFence: false,
		nestedFence: false,
		htmlEnd: null,
		tail: "",
	};
	for (const token of tokens) {
		if (!text.startsWith(token.raw, offset)) break;
		const last = blocks.at(-1);
		const joined = last !== undefined && joins(last, state, token.raw, token);
		const block = last && joined ? last : { start: offset, raw: "", closed: false };
		const wasClosed = block.closed;
		block.raw += token.raw;
		state = nextState(state, token, joined, `${joined ? state.tail : ""}${token.raw}`);
		block.closed = isClosed(wasClosed, state);
		if (block !== last) blocks.push(block);
		offset += token.raw.length;
	}
	const rest = text.slice(offset);
	const last = blocks.at(-1);
	if (!rest) return blocks;
	if (last && joins(last, state, rest)) {
		last.raw += rest;
		last.closed = !isContinued(state) && BLANK_LINE_END.test(last.raw);
	} else blocks.push({ start: offset, raw: rest, closed: BLANK_LINE_END.test(rest) });
	return blocks;
}

function isFootnoteDefinition(token: Token) {
	return token.type !== "code" && FOOTNOTE_DEFINITION.test(token.raw);
}

function stableCount(blocks: readonly MarkdownBlock[]) {
	for (let index = blocks.length - 3; index >= 0; index -= 1) {
		if (blocks[index]?.closed) return index + 1;
	}
	return 0;
}

function lex(source: string) {
	const lexer = new Lexer({ gfm: true });
	const tokens = lexer.blockTokens(source, []);
	const defines = Object.keys(lexer.tokens.links).length > 0 || tokens.some(isFootnoteDefinition);
	return { tokens, defines };
}

function extend(text: string, previous: MarkdownSplit | undefined): MarkdownSplit {
	if (previous?.tentative) return extend(text, undefined);
	if (previous?.whole) return wholeSplit(text, false);
	const kept = previous ? previous.blocks.slice(0, stableCount(previous.blocks)) : [];
	const boundary = kept.at(-1);
	const from = boundary ? boundary.start + boundary.raw.length : 0;
	const { tokens, defines } = lex(text.slice(from));
	if (defines) {
		const lineEnd = text.lastIndexOf("\n") + 1;
		const ended =
			lineEnd === text.length || (lineEnd > from && lex(text.slice(from, lineEnd)).defines);
		return wholeSplit(text, !ended);
	}
	return {
		text,
		blocks: [...kept, ...toBlocks(text, from, tokens)],
		whole: false,
		tentative: false,
	};
}

function isExtension(text: string, previous: MarkdownSplit) {
	return (
		text.length >= previous.text.length && text.slice(0, previous.text.length) === previous.text
	);
}

export function splitMarkdown(input: string, previous?: MarkdownSplit) {
	const text = input.includes("\r") ? input.replace(/\r\n?/g, "\n") : input;
	const split = previous && isExtension(text, previous) ? previous : undefined;
	if (split?.text === text) return split;
	return extend(text, split);
}

export function createMarkdownSplitter() {
	let last: MarkdownSplit | undefined;
	return (text: string) => {
		last = splitMarkdown(text, last);
		return last;
	};
}
