import type { AskUserQuestionItem } from "@thinkrail/pi-ask-user-question/core";
import { type PreviewSource, previewSource } from "./previews";
import { readRecommendation } from "./state";

export type CompareView = "single" | "pair" | "grid";

export const COMPARE_VIEWS: readonly CompareView[] = ["single", "pair", "grid"];

export interface CompareItem {
	key: string;
	label: string;
	option: { label: string; index: number } | null;
	recommended: boolean;
	source: PreviewSource | null;
}

export interface CompareState {
	view: CompareView;
	focus: number;
	left: number;
}

export function compareItems(question: AskUserQuestionItem, currentLabel: string): CompareItem[] {
	const items: CompareItem[] = [];
	const current = previewSource(question);
	if (current) {
		items.push({
			key: "current",
			label: currentLabel,
			option: null,
			recommended: false,
			source: current,
		});
	}
	question.options.forEach((option, index) => {
		const { text, recommended } = readRecommendation(option);
		items.push({
			key: `option:${option.label}`,
			label: text,
			option: { label: option.label, index },
			recommended,
			source: previewSource(option),
		});
	});
	return items;
}

export function compareIndexOf(question: AskUserQuestionItem, optionIndex: number | null): number {
	const offset = previewSource(question) ? 1 : 0;
	return optionIndex === null ? 0 : optionIndex + offset;
}

function pairPartner(items: readonly CompareItem[], right: number): number {
	const preferred = [
		items.findIndex((item) => item.option === null),
		items.findIndex((item) => item.recommended),
		items.findIndex((item) => item.option !== null),
	];
	for (const index of preferred) if (index >= 0 && index !== right) return index;
	const other = items.findIndex((_, index) => index !== right);
	return other >= 0 ? other : right;
}

export function compareStart(items: readonly CompareItem[], start: number): CompareState {
	const focus = Math.min(Math.max(start, 0), Math.max(items.length - 1, 0));
	return { view: "single", focus, left: pairPartner(items, focus) };
}

export function flipCompare(state: CompareState, count: number, delta: 1 | -1): CompareState {
	if (count < 2) return state;
	let focus = (state.focus + delta + count) % count;
	if (state.view === "pair" && focus === state.left && count > 2) {
		focus = (focus + delta + count) % count;
	}
	if (state.view === "pair" && focus === state.left) return swapCompare(state);
	return { ...state, focus };
}

export function showCompareItem(state: CompareState, index: number): CompareState {
	if (state.view === "grid") return { ...state, view: "single", focus: index };
	if (state.view === "pair" && index === state.left) return swapCompare(state);
	return { ...state, focus: index };
}

export function setCompareLeft(state: CompareState, index: number): CompareState {
	if (index === state.focus) return swapCompare(state);
	return { ...state, left: index };
}

export function swapCompare(state: CompareState): CompareState {
	return { ...state, focus: state.left, left: state.focus };
}

export function setCompareView(
	state: CompareState,
	items: readonly CompareItem[],
	view: CompareView,
): CompareState {
	const left = state.left === state.focus ? pairPartner(items, state.focus) : state.left;
	return { ...state, view, left };
}

export function compareJumpIndex(key: string, count: number): number | null {
	if (!/^[1-9]$/.test(key)) return null;
	const index = Number(key) - 1;
	return index < count ? index : null;
}

type VisualKind = "html" | "image" | "svg";

function visualKind(source: PreviewSource | null): VisualKind | null {
	if (source?.kind !== "file" || source.before !== undefined) return null;
	if (/\.html?$/i.test(source.path)) return "html";
	if (/\.svg$/i.test(source.path)) return "svg";
	if (/\.(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(source.path)) return "image";
	return null;
}

export function pairsVisually(left: CompareItem, right: CompareItem): boolean {
	const kind = visualKind(left.source);
	return kind !== null && kind === visualKind(right.source);
}

export function hasHtmlFile(items: readonly CompareItem[]): boolean {
	return items.some(
		(item) =>
			item.source?.kind === "file" &&
			[item.source.path, item.source.before].some((path) => !!path && /\.html?$/i.test(path)),
	);
}
