import type { TerminalPathTarget } from "@thinkrail/contracts";
import type { IBufferRange, ILink, ILinkProvider } from "@xterm/xterm";
import { parseTerminalLinks, type TerminalLink } from "./parseTerminalLinks";

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

export interface LogicalLine {
	text: string;
	cells: LogicalLineCell[];
}

export type TerminalLinkTarget =
	| { kind: "url"; url: string }
	| { kind: "file"; path: string; line?: number; col?: number }
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
const MAX_CANDIDATES = 64;
const RESOLUTION_TTL_MS = 2_000;
const NO_TARGET: TerminalPathTarget = { kind: null, relPath: null };

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
			const chars = cell?.getChars() || " ";
			for (let unit = 0; unit < chars.length; unit += 1) {
				text += chars[unit];
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
	if (link.kind === "url") return { kind: "url", url: link.path };
	if (resolved.kind === "dir") return { kind: "dir", path: resolved.relPath };
	if (resolved.kind !== "file") return null;
	return {
		kind: "file",
		path: resolved.relPath,
		...(link.line === undefined ? {} : { line: link.line }),
		...(link.col === undefined ? {} : { col: link.col }),
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
				() => [] as TerminalPathTarget[],
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
			const onRow = (line ? parseTerminalLinks(line.text) : []).flatMap((link) => {
				const range = line ? bufferRange(line, link) : null;
				return range && range.start.y - 1 <= row && range.end.y - 1 >= row ? [{ link, range }] : [];
			});
			if (!line || onRow.length === 0) {
				callback(undefined);
				return;
			}
			const paths = [
				...new Set(onRow.filter(({ link }) => link.kind === "path").map(({ link }) => link.path)),
			].slice(0, MAX_CANDIDATES);
			const pending = lookup(paths);
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
