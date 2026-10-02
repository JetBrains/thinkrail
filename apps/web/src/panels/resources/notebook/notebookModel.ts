import type { ReviewAnchor } from "@thinkrail/contracts";
import { diffArrays } from "diff";
import { shikiLanguageId } from "@/lib/highlighter";
import type { AnchorDraft, ReviewThread } from "@/resources";
import { scanJson } from "../json/jsonScanner";

export type NotebookCellType = "markdown" | "code" | "raw";
export type NotebookImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/svg+xml";

export type NotebookOutput =
	| { kind: "text"; outputType: "stream" | "text/plain"; text: string }
	| { kind: "error"; text: string }
	| { kind: "image"; mime: NotebookImageMime; data: string }
	| { kind: "html"; html: string }
	| { kind: "json"; value: unknown };

export interface NotebookCell {
	index: number;
	id?: string;
	ref: string;
	type: NotebookCellType;
	source: string;
	startLine: number;
	endLine: number;
	executionCount: number | string | null;
	outputs: NotebookOutput[];
	raw: Readonly<Record<string, unknown>>;
}

export interface NotebookDocument {
	language: string;
	cells: NotebookCell[];
	cellOrdinals: ReadonlyMap<string, number>;
}

export type AlignedNotebookCell =
	| { state: "added"; modified: NotebookCell }
	| { state: "removed"; original: NotebookCell }
	| {
			state: "changed" | "unchanged";
			original: NotebookCell;
			modified: NotebookCell;
	  };

const IMAGE_MIMES: readonly NotebookImageMime[] = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/svg+xml",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
		return value.join("");
	}
	return null;
}

function notebookSource(value: unknown): string | null {
	return stringValue(value);
}

function tracebackValue(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
		return value.join("\n");
	}
	return null;
}

function languageOf(root: Record<string, unknown>): string {
	const metadata = root.metadata;
	if (!isRecord(metadata)) return "python";
	const kernelspec = metadata.kernelspec;
	const languageInfo = metadata.language_info;
	const value =
		isRecord(kernelspec) && typeof kernelspec.language === "string" && kernelspec.language
			? kernelspec.language
			: isRecord(languageInfo) && typeof languageInfo.name === "string" && languageInfo.name
				? languageInfo.name
				: null;
	return value === null ? "python" : (shikiLanguageId(value) ?? "");
}

export function stripAnsi(text: string): string {
	let result = "";
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code === 0x1b) {
			const next = text.charCodeAt(index + 1);
			if (next === 0x5b) {
				index += 2;
				while (index < text.length) {
					const final = text.charCodeAt(index);
					if (final >= 0x40 && final <= 0x7e) break;
					index += 1;
				}
				continue;
			}
			if (next === 0x5d) {
				index += 2;
				while (index < text.length) {
					const current = text.charCodeAt(index);
					if (current === 0x07) break;
					if (current === 0x1b && text.charCodeAt(index + 1) === 0x5c) {
						index += 1;
						break;
					}
					index += 1;
				}
				continue;
			}
			if (index + 1 < text.length) index += 1;
			continue;
		}
		if (code === 0x9b) {
			index += 1;
			while (index < text.length) {
				const final = text.charCodeAt(index);
				if (final >= 0x40 && final <= 0x7e) break;
				index += 1;
			}
			continue;
		}
		result += text[index] ?? "";
	}
	return result;
}

export function selectNotebookMime(data: unknown): NotebookOutput | null {
	if (!isRecord(data)) return null;
	for (const mime of IMAGE_MIMES) {
		const value = stringValue(data[mime]);
		if (value !== null) return { kind: "image", mime, data: value };
	}
	const html = stringValue(data["text/html"]);
	if (html !== null) return { kind: "html", html };
	if (Object.hasOwn(data, "application/json")) {
		return { kind: "json", value: data["application/json"] };
	}
	const plain = stringValue(data["text/plain"]);
	return plain === null ? null : { kind: "text", outputType: "text/plain", text: plain };
}

function parseOutput(value: unknown): NotebookOutput | null {
	if (!isRecord(value) || typeof value.output_type !== "string") return null;
	if (value.output_type === "stream") {
		const text = stringValue(value.text);
		return text === null ? null : { kind: "text", outputType: "stream", text: stripAnsi(text) };
	}
	if (value.output_type === "error") {
		const traceback = tracebackValue(value.traceback);
		const name = typeof value.ename === "string" ? value.ename : "Error";
		const message = typeof value.evalue === "string" ? value.evalue : "";
		return {
			kind: "error",
			text: stripAnsi(traceback || `${name}${message ? `: ${message}` : ""}`),
		};
	}
	if (value.output_type === "display_data" || value.output_type === "execute_result") {
		return selectNotebookMime(value.data);
	}
	return null;
}

export function parseNotebook(text: string): NotebookDocument | null {
	const scanned = scanJson(text);
	if (!scanned || !isRecord(scanned.value)) return null;
	const root = scanned.value;
	if (root.nbformat !== 4 || !Array.isArray(root.cells)) return null;
	const minor = typeof root.nbformat_minor === "number" ? root.nbformat_minor : 0;
	const cells: NotebookCell[] = [];
	for (let index = 0; index < root.cells.length; index += 1) {
		const raw = root.cells[index];
		const node = scanned.nodes.get(`/cells/${index}`);
		if (!isRecord(raw) || !node) return null;
		const type = raw.cell_type;
		if (type !== "markdown" && type !== "code" && type !== "raw") return null;
		const source = notebookSource(raw.source);
		if (source === null) return null;
		const id = minor >= 5 && typeof raw.id === "string" && raw.id ? raw.id : undefined;
		const executionCount =
			type === "code" &&
			(raw.execution_count === null ||
				typeof raw.execution_count === "number" ||
				typeof raw.execution_count === "string")
				? raw.execution_count
				: null;
		const outputs =
			type === "code" && Array.isArray(raw.outputs)
				? raw.outputs.flatMap((output) => {
						const parsed = parseOutput(output);
						return parsed ? [parsed] : [];
					})
				: [];
		cells.push({
			index,
			...(id ? { id } : {}),
			ref: id ?? `index:${index}`,
			type,
			source,
			startLine: node.startLine,
			endLine: node.endLine,
			executionCount,
			outputs,
			raw,
		});
	}
	return {
		language: languageOf(root),
		cells,
		cellOrdinals: new Map(cells.map((cell) => [cell.ref, cell.index + 1])),
	};
}

export function notebookCellDraft(cell: NotebookCell): AnchorDraft {
	return {
		selectors: [
			{ kind: "lineRange", startLine: cell.startLine, endLine: cell.endLine },
			{ kind: "structural", scheme: "ipynb-cell", ref: cell.ref },
		],
		label: `cell ${cell.index + 1}`,
	};
}

export function notebookCellOfAnchor(
	anchor: ReviewAnchor,
	document: NotebookDocument,
): NotebookCell | null {
	const selector = anchor.selectors.find(
		(candidate) => candidate.kind === "structural" && candidate.scheme === "ipynb-cell",
	);
	if (selector?.kind !== "structural") return null;
	const indexed = /^index:(\d+)$/.exec(selector.ref);
	const cell = indexed
		? (document.cells[Number(indexed[1])] ?? null)
		: (document.cells.find((candidate) => candidate.ref === selector.ref) ?? null);
	if (!cell) return null;
	const lines = anchor.selectors.find((candidate) => candidate.kind === "lineRange");
	if (
		lines?.kind === "lineRange" &&
		(cell.endLine < lines.startLine || cell.startLine > lines.endLine)
	) {
		return null;
	}
	return cell;
}

export function placedNotebookThreadIds(
	threads: readonly ReviewThread[],
	document: NotebookDocument | null,
): ReadonlySet<string> {
	if (!document) return new Set();
	return new Set(
		threads.flatMap((thread) => (notebookCellOfAnchor(thread.anchor, document) ? [thread.id] : [])),
	);
}

export function normalizedCellSource(source: string): string {
	return source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
}

const MAX_SIMILARITY_LINES = 256;

interface SourceTokens {
	lines: readonly string[];
	unique: ReadonlySet<string>;
}

function sourceTokens(source: string): SourceTokens {
	const normalized = normalizedCellSource(source);
	if (!normalized) return { lines: [], unique: new Set() };
	const lines = normalized.split("\n");
	const bounded =
		lines.length <= MAX_SIMILARITY_LINES
			? lines
			: [...lines.slice(0, MAX_SIMILARITY_LINES / 2), ...lines.slice(-(MAX_SIMILARITY_LINES / 2))];
	return { lines: bounded, unique: new Set(bounded) };
}

function tokenSimilarity(left: SourceTokens, right: SourceTokens): number {
	if (left.lines.length === 0 && right.lines.length === 0) return 1;
	let overlaps = false;
	for (const line of left.unique) {
		if (right.unique.has(line)) {
			overlaps = true;
			break;
		}
	}
	if (!overlaps) return 0;
	const shared = (diffArrays([...left.lines], [...right.lines]) ?? [])
		.filter((part) => !part.added && !part.removed)
		.reduce((total, part) => total + part.value.length, 0);
	return shared / Math.max(left.lines.length, right.lines.length, 1);
}

export function notebookSourceSimilarity(left: string, right: string): number {
	return tokenSimilarity(sourceTokens(left), sourceTokens(right));
}

interface CellMatch {
	original: number;
	modified: number;
}

interface CellRun {
	originalStart: number;
	originalEnd: number;
	modifiedStart: number;
	modifiedEnd: number;
}

function sequenceMatches(left: readonly string[], right: readonly string[]): CellMatch[] {
	let leftIndex = 0;
	let rightIndex = 0;
	const matches: CellMatch[] = [];
	for (const part of diffArrays([...left], [...right]) ?? []) {
		if (part.added) {
			rightIndex += part.value.length;
			continue;
		}
		if (part.removed) {
			leftIndex += part.value.length;
			continue;
		}
		for (let offset = 0; offset < part.value.length; offset += 1) {
			matches.push({ original: leftIndex + offset, modified: rightIndex + offset });
		}
		leftIndex += part.value.length;
		rightIndex += part.value.length;
	}
	return matches;
}

function runsBetween(
	matches: readonly CellMatch[],
	originalLength: number,
	modifiedLength: number,
): CellRun[] {
	const runs: CellRun[] = [];
	let originalStart = 0;
	let modifiedStart = 0;
	for (const match of matches) {
		if (originalStart < match.original || modifiedStart < match.modified) {
			runs.push({
				originalStart,
				originalEnd: match.original,
				modifiedStart,
				modifiedEnd: match.modified,
			});
		}
		originalStart = match.original + 1;
		modifiedStart = match.modified + 1;
	}
	if (originalStart < originalLength || modifiedStart < modifiedLength) {
		runs.push({
			originalStart,
			originalEnd: originalLength,
			modifiedStart,
			modifiedEnd: modifiedLength,
		});
	}
	return runs;
}

function similarityMatches(
	original: readonly NotebookCell[],
	modified: readonly NotebookCell[],
	run: CellRun,
	originalTokens: readonly SourceTokens[],
	modifiedTokens: readonly SourceTokens[],
): CellMatch[] {
	const originalLength = run.originalEnd - run.originalStart;
	const modifiedLength = run.modifiedEnd - run.modifiedStart;
	if (originalLength === 0 || modifiedLength === 0) return [];
	const columns = modifiedLength + 1;
	const counts = new Int32Array((originalLength + 1) * columns);
	const scores = new Float64Array((originalLength + 1) * columns);
	const actions = new Uint8Array((originalLength + 1) * columns);
	const better = (count: number, score: number, bestCount: number, bestScore: number) =>
		count > bestCount || (count === bestCount && score > bestScore);

	for (let left = 1; left <= originalLength; left += 1) {
		for (let right = 1; right <= modifiedLength; right += 1) {
			const index = left * columns + right;
			const above = (left - 1) * columns + right;
			const before = left * columns + right - 1;
			let bestCount = counts[above] ?? 0;
			let bestScore = scores[above] ?? 0;
			let action = 2;
			const beforeCount = counts[before] ?? 0;
			const beforeScore = scores[before] ?? 0;
			if (better(beforeCount, beforeScore, bestCount, bestScore)) {
				bestCount = beforeCount;
				bestScore = beforeScore;
				action = 3;
			}

			const originalIndex = run.originalStart + left - 1;
			const modifiedIndex = run.modifiedStart + right - 1;
			const leftCell = original[originalIndex];
			const rightCell = modified[modifiedIndex];
			if (leftCell && rightCell && leftCell.type === rightCell.type) {
				const similarity = tokenSimilarity(
					originalTokens[originalIndex] ?? sourceTokens(leftCell.source),
					modifiedTokens[modifiedIndex] ?? sourceTokens(rightCell.source),
				);
				if (similarity >= 0.5) {
					const diagonal = (left - 1) * columns + right - 1;
					const matchedCount = (counts[diagonal] ?? 0) + 1;
					const matchedScore = (scores[diagonal] ?? 0) + similarity;
					if (
						better(matchedCount, matchedScore, bestCount, bestScore) ||
						(matchedCount === bestCount && matchedScore === bestScore)
					) {
						bestCount = matchedCount;
						bestScore = matchedScore;
						action = 1;
					}
				}
			}
			counts[index] = bestCount;
			scores[index] = bestScore;
			actions[index] = action;
		}
	}

	const matches: CellMatch[] = [];
	let left = originalLength;
	let right = modifiedLength;
	while (left > 0 && right > 0) {
		const action = actions[left * columns + right];
		if (action === 1) {
			matches.push({
				original: run.originalStart + left - 1,
				modified: run.modifiedStart + right - 1,
			});
			left -= 1;
			right -= 1;
		} else if (action === 2) {
			left -= 1;
		} else {
			right -= 1;
		}
	}
	return matches.reverse();
}

function sameCell(left: NotebookCell, right: NotebookCell): boolean {
	return JSON.stringify(left.raw) === JSON.stringify(right.raw);
}

export function alignNotebookCells(
	original: readonly NotebookCell[],
	modified: readonly NotebookCell[],
): AlignedNotebookCell[] {
	const idMatches = sequenceMatches(
		original.map((cell, index) =>
			cell.id ? JSON.stringify(["id", cell.id]) : JSON.stringify(["original", index]),
		),
		modified.map((cell, index) =>
			cell.id ? JSON.stringify(["id", cell.id]) : JSON.stringify(["modified", index]),
		),
	);
	const exactMatches = runsBetween(idMatches, original.length, modified.length).flatMap((run) =>
		sequenceMatches(
			original
				.slice(run.originalStart, run.originalEnd)
				.map((cell) => JSON.stringify([cell.type, normalizedCellSource(cell.source)])),
			modified
				.slice(run.modifiedStart, run.modifiedEnd)
				.map((cell) => JSON.stringify([cell.type, normalizedCellSource(cell.source)])),
		).map((match) => ({
			original: run.originalStart + match.original,
			modified: run.modifiedStart + match.modified,
		})),
	);
	const anchors = [...idMatches, ...exactMatches].sort((left, right) =>
		left.original === right.original
			? left.modified - right.modified
			: left.original - right.original,
	);
	const originalTokens = original.map((cell) => sourceTokens(cell.source));
	const modifiedTokens = modified.map((cell) => sourceTokens(cell.source));
	const similarMatches = runsBetween(anchors, original.length, modified.length).flatMap((run) =>
		similarityMatches(original, modified, run, originalTokens, modifiedTokens),
	);
	const matches = [...anchors, ...similarMatches].sort(
		(left, right) => left.modified - right.modified,
	);
	const matchByModified = new Map(matches.map((match) => [match.modified, match.original]));
	const matchedOriginal = new Set(matches.map((match) => match.original));
	const emittedOriginal = new Set<number>();
	const result: AlignedNotebookCell[] = [];

	for (let modifiedIndex = 0; modifiedIndex < modified.length; modifiedIndex += 1) {
		const right = modified[modifiedIndex];
		if (!right) continue;
		const originalIndex = matchByModified.get(modifiedIndex);
		if (originalIndex === undefined) {
			result.push({ state: "added", modified: right });
			continue;
		}
		for (let index = 0; index < originalIndex; index += 1) {
			const left = original[index];
			if (left && !matchedOriginal.has(index) && !emittedOriginal.has(index)) {
				result.push({ state: "removed", original: left });
				emittedOriginal.add(index);
			}
		}
		const left = original[originalIndex];
		if (!left) continue;
		emittedOriginal.add(originalIndex);
		result.push({
			state: sameCell(left, right) ? "unchanged" : "changed",
			original: left,
			modified: right,
		});
	}
	for (let index = 0; index < original.length; index += 1) {
		const left = original[index];
		if (left && !emittedOriginal.has(index)) result.push({ state: "removed", original: left });
	}
	return result;
}

export function notebookOutputText(output: NotebookOutput): string | null {
	if (output.kind === "text" || output.kind === "error") return output.text;
	if (output.kind === "json") return JSON.stringify(output.value, null, 2);
	return null;
}
