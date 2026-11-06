export interface TerminalLink {
	start: number;
	end: number;
	kind: "url" | "path";
	path: string;
	line?: number;
	col?: number;
}

interface Span {
	start: number;
	end: number;
}

interface Position {
	line?: number;
	col?: number;
}

const MAX_POSITION = 10_000_000;
const URL_PATTERN = /\b(https?|file):\/\/[^\s<>"'`]+/g;
const TRAILING_URL_PUNCTUATION = /[.,;:!?'"]$/;
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };
const PYTHON_FRAME = /File ("([^"\n]+)", line (\d+))/g;
const PATH_TOKEN = /(?:[A-Za-z]:[\\/])?[^\s"'`<>()|;,:=*?!{}&]+/g;
const QUOTE_OPENS_AFTER = /[\s([{=:,]/;
const QUOTE_CLOSES_BEFORE = /[\s)\]}:,.;(]/;
const LOCATION_SUFFIXES = [
	/:(\d+)(?::(\d+))?/y,
	/\((\d+)(?:,\s?(\d+))?\)/y,
	/: line (\d+)(?:, col(?:umn)? (\d+))?/y,
];
const INNER_LOCATION = /:(\d+)(?::(\d+))?$/;
const EXPLICIT_PREFIX = /^(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])/;
const SEPARATOR = /[\\/]/;
const EXTENSION = /\.\p{L}[\p{L}\p{N}_+-]*$/u;
const LETTER = /\p{L}/u;

function count(text: string, char: string): number {
	let total = 0;
	for (const c of text) if (c === char) total += 1;
	return total;
}

function trimUrl(url: string): string {
	let trimmed = url;
	while (trimmed.length > 0) {
		const last = trimmed.slice(-1);
		const opener = CLOSERS[last];
		if (TRAILING_URL_PUNCTUATION.test(last)) trimmed = trimmed.slice(0, -1);
		else if (opener !== undefined && count(trimmed, last) > count(trimmed, opener)) {
			trimmed = trimmed.slice(0, -1);
		} else break;
	}
	return trimmed;
}

function position(lineText: string | undefined, colText: string | undefined): Position {
	const line = lineText === undefined ? Number.NaN : Number(lineText);
	if (!Number.isInteger(line) || line < 1 || line > MAX_POSITION) return {};
	const col = colText === undefined ? Number.NaN : Number(colText);
	return Number.isInteger(col) && col >= 1 && col <= MAX_POSITION ? { line, col } : { line };
}

function lastSegment(path: string): string {
	return path.split(SEPARATOR).filter(Boolean).pop() ?? "";
}

function looksLikePath(path: string, hasLocation: boolean): boolean {
	if (!LETTER.test(path)) return false;
	return (
		hasLocation ||
		EXPLICIT_PREFIX.test(path) ||
		SEPARATOR.test(path) ||
		EXTENSION.test(lastSegment(path))
	);
}

function overlaps(spans: readonly Span[], start: number, end: number): Span | undefined {
	return spans.find((span) => start < span.end && end > span.start);
}

function pathLink(start: number, end: number, path: string, at: Position): TerminalLink {
	return { start, end, kind: "path", path, ...at };
}

function urlLinks(text: string, masked: Span[]): TerminalLink[] {
	const found: TerminalLink[] = [];
	for (const match of text.matchAll(URL_PATTERN)) {
		const url = trimUrl(match[0]);
		const start = match.index;
		const end = start + url.length;
		if (url.length <= `${match[1]}://`.length) continue;
		masked.push({ start, end });
		if (match[1] !== "file") {
			found.push({ start, end, kind: "url", path: url });
			continue;
		}
		const location = INNER_LOCATION.exec(url);
		const rawPath = url.slice("file://".length, location ? location.index : undefined);
		let path: string;
		try {
			path = decodeURI(rawPath);
		} catch {
			continue;
		}
		const native = /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
		found.push(pathLink(start, end, native, position(location?.[1], location?.[2])));
	}
	return found;
}

function pythonFrames(text: string, masked: Span[]): TerminalLink[] {
	const found: TerminalLink[] = [];
	for (const match of text.matchAll(PYTHON_FRAME)) {
		const located = match[1] ?? "";
		const start = match.index + match[0].length - located.length;
		const end = start + located.length;
		if (overlaps(masked, start, end)) continue;
		masked.push({ start, end });
		found.push(pathLink(start, end, match[2] ?? "", position(match[3], undefined)));
	}
	return found;
}

function locationAt(text: string, index: number): { length: number; at: Position } | null {
	for (const suffix of LOCATION_SUFFIXES) {
		suffix.lastIndex = index;
		const match = suffix.exec(text);
		if (match) return { length: match[0].length, at: position(match[1], match[2]) };
	}
	return null;
}

function closingQuote(text: string, quote: string, from: number): number {
	for (
		let index = text.indexOf(quote, from);
		index !== -1;
		index = text.indexOf(quote, index + 1)
	) {
		const after = text[index + 1];
		if (after === undefined || QUOTE_CLOSES_BEFORE.test(after)) return index;
	}
	return -1;
}

function quotedPaths(text: string, masked: readonly Span[]): TerminalLink[] {
	const found: TerminalLink[] = [];
	const unclosed = new Set<string>();
	for (let open = 0; open < text.length; open += 1) {
		const quote = text[open];
		if ((quote !== '"' && quote !== "'") || unclosed.has(quote)) continue;
		const before = text[open - 1];
		if (before !== undefined && !QUOTE_OPENS_AFTER.test(before)) continue;
		const close = closingQuote(text, quote, open + 1);
		if (close === -1) {
			unclosed.add(quote);
			continue;
		}
		const content = text.slice(open + 1, close);
		const inner = INNER_LOCATION.exec(content);
		const path = inner ? content.slice(0, inner.index) : content;
		const after = inner ? null : locationAt(text, close + 1);
		const end = close + 1 + (after?.length ?? 0);
		if (
			/\s/.test(path) &&
			path.trim() === path &&
			!path.includes("://") &&
			!overlaps(masked, open, end) &&
			looksLikePath(path, false)
		) {
			found.push(
				pathLink(open, end, path, inner ? position(inner[1], inner[2]) : (after?.at ?? {})),
			);
		}
		open = close;
	}
	return found;
}

function trimToken(token: string): { offset: number; text: string } {
	let offset = 0;
	let text = token;
	if (text.startsWith("[") && text.endsWith("]")) {
		text = text.slice(1, -1);
		offset = 1;
	}
	if (text.startsWith("[") && count(text, "[") > count(text, "]")) {
		text = text.slice(1);
		offset += 1;
	}
	while (text.endsWith("]") && count(text, "]") > count(text, "[")) text = text.slice(0, -1);
	if (!/^\.{1,2}[\\/]?$/.test(text)) text = text.replace(/\.+$/, "");
	return { offset, text };
}

function tokenPaths(text: string, masked: readonly Span[]): TerminalLink[] {
	const found: TerminalLink[] = [];
	const tokens = new RegExp(PATH_TOKEN.source, "g");
	for (let match = tokens.exec(text); match !== null; match = tokens.exec(text)) {
		const raw = match[0];
		const rawStart = match.index;
		const mask = overlaps(masked, rawStart, rawStart + raw.length);
		if (mask) {
			tokens.lastIndex = Math.max(mask.end, rawStart + 1);
			continue;
		}
		const { offset, text: path } = trimToken(raw);
		const start = rawStart + offset;
		const pathEnd = start + path.length;
		const location = pathEnd === rawStart + raw.length ? locationAt(text, pathEnd) : null;
		if (path === "" || !looksLikePath(path, location !== null)) continue;
		const end = pathEnd + (location?.length ?? 0);
		found.push(pathLink(start, end, path, location?.at ?? {}));
		tokens.lastIndex = Math.max(tokens.lastIndex, end);
	}
	return found;
}

export function parseTerminalLinks(text: string): TerminalLink[] {
	const masked: Span[] = [];
	const links = [...urlLinks(text, masked), ...pythonFrames(text, masked)];
	links.push(...quotedPaths(text, masked), ...tokenPaths(text, masked));
	return links.sort((a, b) => a.start - b.start || b.end - a.end);
}
