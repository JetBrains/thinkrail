import type { IBufferRange, ILink, ILinkProvider } from "@xterm/xterm";

/** A URL found in a logical line, as `[start, end)` indices into its text. */
export interface TerminalUrl {
	start: number;
	end: number;
	url: string;
}

export interface TerminalCellLike {
	getChars(): string;
	getWidth(): number;
}

export interface TerminalLineLike {
	readonly isWrapped: boolean;
	readonly length: number;
	getCell(x: number): TerminalCellLike | undefined;
}

export interface TerminalBufferLike {
	readonly length: number;
	getLine(y: number): TerminalLineLike | undefined;
}

export interface LogicalLineCell {
	x: number;
	y: number;
	width: number;
}

/** One soft-wrapped line of output, with the buffer cell behind each UTF-16 unit of its text. */
export interface LogicalLine {
	text: string;
	cells: LogicalLineCell[];
}

export interface TerminalLinkProviderOptions {
	buffer(): TerminalBufferLike;
	open(url: string): void;
	isActivation(event: MouseEvent): boolean;
	showHint(visible: boolean): void;
}

const MAX_WRAPPED_ROWS = 32;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/g;
const TRAILING_URL_PUNCTUATION = /[.,;:!?'"]$/;
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{", ">": "<" };
const OPENERS = new Set(Object.values(CLOSERS));

// Trailing punctuation and unbalanced closers belong to the prose around a URL, not to it. Counts are
// taken once and updated as characters come off, so a long run of closers stays linear.
function trimUrl(url: string): string {
	const brackets = new Map<string, number>();
	for (const char of url) {
		if (char in CLOSERS || OPENERS.has(char)) brackets.set(char, (brackets.get(char) ?? 0) + 1);
	}
	let end = url.length;
	while (end > 0) {
		const last = url[end - 1] ?? "";
		const opener = CLOSERS[last];
		if (TRAILING_URL_PUNCTUATION.test(last)) end -= 1;
		else if (opener !== undefined && (brackets.get(last) ?? 0) > (brackets.get(opener) ?? 0)) {
			brackets.set(last, (brackets.get(last) ?? 0) - 1);
			end -= 1;
		} else break;
	}
	return url.slice(0, end);
}

export function parseTerminalUrls(text: string): TerminalUrl[] {
	const found: TerminalUrl[] = [];
	for (const match of text.matchAll(URL_PATTERN)) {
		const url = trimUrl(match[0]);
		if (url.length <= url.indexOf("://") + 3) continue;
		found.push({ start: match.index, end: match.index + url.length, url });
	}
	return found;
}

// When a wide character no longer fits at the end of a row, xterm leaves that last cell empty and
// starts the next (wrapped) row with the character. The empty cell is layout, not a printed space.
function isWideWrapPadding(buffer: TerminalBufferLike, row: number): boolean {
	const next = buffer.getLine(row + 1);
	return next?.isWrapped === true && next.getCell(0)?.getWidth() === 2;
}

export function readLogicalLine(buffer: TerminalBufferLike, y: number): LogicalLine | null {
	if (!buffer.getLine(y)) return null;
	let top = y;
	while (top > 0 && y - top < MAX_WRAPPED_ROWS && buffer.getLine(top)?.isWrapped) top -= 1;
	let bottom = y;
	while (
		bottom + 1 < buffer.length &&
		bottom - y < MAX_WRAPPED_ROWS &&
		buffer.getLine(bottom + 1)?.isWrapped
	) {
		bottom += 1;
	}
	let text = "";
	const cells: LogicalLineCell[] = [];
	for (let row = top; row <= bottom; row += 1) {
		const line = buffer.getLine(row);
		if (!line) break;
		for (let x = 0; x < line.length; x += 1) {
			const cell = line.getCell(x);
			const width = cell?.getWidth() ?? 1;
			if (width === 0) continue;
			const chars = cell?.getChars() ?? "";
			if (chars === "" && x === line.length - 1 && isWideWrapPadding(buffer, row)) continue;
			const shown = chars || " ";
			for (let unit = 0; unit < shown.length; unit += 1) {
				text += shown[unit];
				cells.push({ x, y: row, width });
			}
		}
	}
	const kept = text.trimEnd().length;
	return { text: text.slice(0, kept), cells: cells.slice(0, kept) };
}

function bufferRange(line: LogicalLine, link: TerminalUrl): IBufferRange | null {
	const first = line.cells[link.start];
	const last = line.cells[link.end - 1];
	if (!first || !last) return null;
	return {
		start: { x: first.x + 1, y: first.y + 1 },
		end: { x: last.x + last.width, y: last.y + 1 },
	};
}

/** xterm link provider for the URLs a terminal printed; a click opens one only with the modifier held. */
export function createTerminalLinkProvider(options: TerminalLinkProviderOptions): ILinkProvider {
	const toLink = (url: string, range: IBufferRange): ILink => ({
		range,
		text: url,
		decorations: { pointerCursor: true, underline: true },
		activate: (event) => {
			if (options.isActivation(event)) options.open(url);
		},
		hover: () => options.showHint(true),
		leave: () => options.showHint(false),
	});

	return {
		provideLinks(bufferLineNumber, callback) {
			const row = bufferLineNumber - 1;
			const line = readLogicalLine(options.buffer(), row);
			const links = (line ? parseTerminalUrls(line.text) : []).flatMap((link) => {
				const range = line ? bufferRange(line, link) : null;
				// xterm asks row by row; a wrapped URL is offered from each row it covers, once per row.
				if (!range || range.start.y - 1 > row || range.end.y - 1 < row) return [];
				return [toLink(link.url, range)];
			});
			callback(links.length > 0 ? links : undefined);
		},
	};
}
