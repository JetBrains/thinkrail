import {
	MAX_TERMINAL_PATH_CANDIDATES,
	MAX_TERMINAL_PATH_LENGTH,
	type TerminalPathTarget,
} from "@thinkrail/contracts";
import type { IBufferRange, ILink, ILinkProvider } from "@xterm/xterm";
import { parseTerminalLinks, type TerminalLink } from "./terminalLinkParse";

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

export type TerminalLinkTarget =
	| { kind: "url"; url: string }
	| { kind: "file"; path: string; line?: number; column?: number }
	| { kind: "dir"; path: string };

export interface TerminalLinkProviderOptions {
	buffer(): TerminalBufferLike;
	resolve(candidates: string[]): Promise<TerminalPathTarget[]>;
	open(target: TerminalLinkTarget): void;
	isActivation(event: MouseEvent): boolean;
	showHint(visible: boolean): void;
	now?: () => number;
}

const MAX_WRAPPED_ROWS = 32;
const RESOLUTION_TTL_MS = 2_000;
const NO_TARGET: TerminalPathTarget = { kind: null, relPath: null };

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

function bufferRange(line: LogicalLine, link: TerminalLink): IBufferRange | null {
	const first = line.cells[link.start];
	const last = line.cells[link.end - 1];
	if (!first || !last) return null;
	return {
		start: { x: first.x + 1, y: first.y + 1 },
		end: { x: last.x + last.width, y: last.y + 1 },
	};
}

function targetFor(link: TerminalLink, resolved: TerminalPathTarget): TerminalLinkTarget | null {
	if (link.kind === "url") return { kind: "url", url: link.url };
	if (resolved.kind === "dir") return { kind: "dir", path: resolved.relPath };
	if (resolved.kind !== "file") return null;
	return {
		kind: "file",
		path: resolved.relPath,
		...(link.line === undefined ? {} : { line: link.line }),
		...(link.column === undefined ? {} : { column: link.column }),
	};
}

function nonOverlapping<T extends { link: TerminalLink }>(found: T[]): T[] {
	const kept: T[] = [];
	const longestFirst = [...found].sort(
		(a, b) =>
			b.link.end - b.link.start - (a.link.end - a.link.start) || a.link.start - b.link.start,
	);
	for (const candidate of longestFirst) {
		const clashes = kept.some(
			({ link }) => candidate.link.start < link.end && candidate.link.end > link.start,
		);
		if (!clashes) kept.push(candidate);
	}
	return kept.sort((a, b) => a.link.start - b.link.start);
}

function askedPaths(links: readonly { link: TerminalLink }[]): string[] {
	const paths = links.flatMap(({ link }) =>
		link.kind === "path" && link.path.length <= MAX_TERMINAL_PATH_LENGTH ? [link.path] : [],
	);
	return [...new Set(paths)].slice(0, MAX_TERMINAL_PATH_CANDIDATES);
}

/** xterm link provider for printed URLs and the paths the host confirms; a click opens one only with the modifier held. */
export function createTerminalLinkProvider(options: TerminalLinkProviderOptions): ILinkProvider {
	const now = options.now ?? Date.now;
	const resolutions = new Map<string, { at: number; target: Promise<TerminalPathTarget> }>();
	let latestAsk = 0;

	const lookup = (paths: string[]): Map<string, Promise<TerminalPathTarget>> => {
		const at = now();
		for (const [path, entry] of resolutions) {
			if (at - entry.at >= RESOLUTION_TTL_MS) resolutions.delete(path);
		}
		const misses = paths.filter((path) => !resolutions.has(path));
		if (misses.length > 0) {
			const answered = options.resolve(misses).then(
				(targets) => targets,
				(): TerminalPathTarget[] => [],
			);
			for (const [index, path] of misses.entries()) {
				resolutions.set(path, {
					at,
					target: answered.then((targets) => targets[index] ?? NO_TARGET),
				});
			}
		}
		return new Map(
			paths.map((path) => [path, resolutions.get(path)?.target ?? Promise.resolve(NO_TARGET)]),
		);
	};

	const toLink = (text: string, range: IBufferRange, target: TerminalLinkTarget): ILink => ({
		range,
		text,
		decorations: { pointerCursor: true, underline: true },
		activate: (event) => {
			if (options.isActivation(event)) options.open(target);
		},
		hover: () => options.showHint(true),
		leave: () => options.showHint(false),
	});

	return {
		provideLinks(bufferLineNumber, callback) {
			const ask = ++latestAsk;
			const row = bufferLineNumber - 1;
			const line = readLogicalLine(options.buffer(), row);
			// xterm asks row by row; a wrapped link is offered from each row it covers, once per row.
			const onRow = (line ? parseTerminalLinks(line.text) : []).flatMap((link) => {
				const range = line ? bufferRange(line, link) : null;
				return range && range.start.y - 1 <= row && range.end.y - 1 >= row ? [{ link, range }] : [];
			});
			if (!line || onRow.length === 0) {
				callback(undefined);
				return;
			}
			const pending = lookup(askedPaths(onRow));
			void Promise.all(
				onRow.map(async ({ link, range }) => {
					const resolved =
						link.kind === "url" ? NO_TARGET : await (pending.get(link.path) ?? NO_TARGET);
					const target = targetFor(link, resolved);
					return target ? [{ link, range, target }] : [];
				}),
			).then((answered) => {
				if (ask !== latestAsk) return;
				const links = nonOverlapping(answered.flat()).map(({ link, range, target }) =>
					toLink(line.text.slice(link.start, link.end), range, target),
				);
				callback(links.length > 0 ? links : undefined);
			});
		},
	};
}
