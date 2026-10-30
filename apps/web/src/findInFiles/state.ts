import type { TextSearchBatch, TextSearchFile } from "@thinkrail/contracts";
import { create } from "zustand";

export interface FindInFilesSelection {
	path: string;
	line: number;
}

export interface FindInFilesResults {
	seq: number;
	contextKey: string;
	root: NonNullable<TextSearchBatch["root"]> | null;
	files: readonly TextSearchFile[];
	done: TextSearchBatch["done"] | null;
}

export interface FindInFilesState {
	open: boolean;
	query: string;
	caseSensitive: boolean;
	wholeWord: boolean;
	searching: boolean;
	failed: boolean;
	results: FindInFilesResults | null;
	selected: FindInFilesSelection | null;
}

const INITIAL: FindInFilesState = {
	open: false,
	query: "",
	caseSensitive: false,
	wholeWord: false,
	searching: false,
	failed: false,
	results: null,
	selected: null,
};

export const useFindInFiles = create<FindInFilesState>(() => INITIAL);

export function openFindInFiles(): void {
	useFindInFiles.setState({ open: true });
}

export function closeFindInFiles(): void {
	useFindInFiles.setState({ open: false });
}

export function setFindInFilesQuery(query: string): void {
	useFindInFiles.setState({ query });
}

export function toggleFindInFilesCase(): void {
	useFindInFiles.setState((state) => ({ caseSensitive: !state.caseSensitive }));
}

export function toggleFindInFilesWord(): void {
	useFindInFiles.setState((state) => ({ wholeWord: !state.wholeWord }));
}

export function selectFindInFilesMatch(selected: FindInFilesSelection): void {
	useFindInFiles.setState({ selected });
}

export function resetFindInFilesForTests(): void {
	useFindInFiles.setState(INITIAL);
	latest = { seq: -1, contextKey: "" };
}

export function effectiveCaseSensitive(query: string, caseSensitive: boolean): boolean {
	return caseSensitive || /\p{Lu}/u.test(query);
}

export function mergeFiles(
	current: readonly TextSearchFile[],
	incoming: readonly TextSearchFile[],
): TextSearchFile[] {
	const next = [...current];
	const index = new Map(next.map((file, at) => [file.path, at]));
	for (const file of incoming) {
		const at = index.get(file.path);
		const previous = at === undefined ? undefined : next[at];
		if (at === undefined || !previous) {
			index.set(file.path, next.length);
			next.push(file);
		} else {
			next[at] = { path: previous.path, matches: [...previous.matches, ...file.matches] };
		}
	}
	return next;
}

function firstMatch(files: readonly TextSearchFile[]): FindInFilesSelection | null {
	const file = files[0];
	const match = file?.matches[0];
	return file && match ? { path: file.path, line: match.line } : null;
}

let latest = { seq: -1, contextKey: "" };

export function beginTextSearch(seq: number, contextKey: string): void {
	latest = { seq, contextKey };
	useFindInFiles.setState({ searching: true, failed: false });
}

export function clearTextSearch(): void {
	latest = { seq: latest.seq, contextKey: "" };
	useFindInFiles.setState({ searching: false, failed: false, results: null, selected: null });
}

export function failTextSearch(seq: number): void {
	if (seq !== latest.seq) return;
	useFindInFiles.setState({ searching: false, failed: true });
}

export function applyTextSearchBatch(batch: TextSearchBatch): boolean {
	if (batch.seq !== latest.seq) return false;
	useFindInFiles.setState((state) => {
		const fresh = state.results?.seq !== batch.seq;
		const files = fresh ? [...batch.files] : mergeFiles(state.results?.files ?? [], batch.files);
		const results: FindInFilesResults = {
			seq: batch.seq,
			contextKey: latest.contextKey,
			root: batch.root ?? (fresh ? null : (state.results?.root ?? null)),
			files,
			done: batch.done ?? null,
		};
		const keep =
			!fresh && state.selected !== null && files.some((file) => file.path === state.selected?.path);
		return {
			results,
			selected: keep ? state.selected : firstMatch(files),
			searching: batch.done === undefined,
			failed: batch.done?.reason === "failed",
		};
	});
	return true;
}
