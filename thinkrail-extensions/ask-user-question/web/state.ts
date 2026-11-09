import type {
	AskUserQuestionAnswer,
	AskUserQuestionArgs,
	AskUserQuestionDiscussReason,
	AskUserQuestionItem,
	AskUserQuestionOption,
} from "@thinkrail/pi-ask-user-question/core";

export function parseQuestions(args: Record<string, unknown>): AskUserQuestionItem[] {
	const qs = (args as Partial<AskUserQuestionArgs>).questions;
	return Array.isArray(qs) ? qs.filter((q) => q && Array.isArray(q.options)) : [];
}

export function splitRecommended(label: string): { text: string; recommended: boolean } {
	const m = /\s*\(recommended\)\s*$/i.exec(label);
	return m
		? { text: label.slice(0, m.index).trim(), recommended: true }
		: { text: label, recommended: false };
}

export function readRecommendation(option: {
	label: string;
	recommendedReason?: string | undefined;
}): {
	text: string;
	recommended: boolean;
	reason?: string | undefined;
} {
	const { text, recommended } = splitRecommended(option.label);
	const reason = option.recommendedReason?.trim() || undefined;
	return { text, recommended: recommended || !!reason, reason };
}

export interface QState {
	option: string | null;
	customText: string;
	customActive: boolean;
	multi: string[];
	cursor: number;
	notes: Record<string, string>;
	noteFor: string | null;
	discuss: boolean;
	discussReason: AskUserQuestionDiscussReason | null;
	discussText: string;
	previewExpanded: boolean;
}

export const emptyQState = (): QState => ({
	option: null,
	customText: "",
	customActive: false,
	multi: [],
	cursor: 0,
	notes: {},
	noteFor: null,
	discuss: false,
	discussReason: null,
	discussText: "",
	previewExpanded: false,
});

export const DISCUSS_REASONS: readonly AskUserQuestionDiscussReason[] = [
	"unclear",
	"irrelevant",
	"context",
];

export function previewEcho(
	option: AskUserQuestionOption,
): Pick<AskUserQuestionAnswer, "preview" | "previewFile" | "previewBefore"> {
	if (option.previewFile)
		return {
			previewFile: option.previewFile,
			...(option.previewBefore ? { previewBefore: option.previewBefore } : {}),
		};
	return option.preview ? { preview: option.preview } : {};
}

export function deriveAnswer(
	question: AskUserQuestionItem,
	index: number,
	state: QState,
): AskUserQuestionAnswer | null {
	const base = { questionIndex: index, question: question.question };
	if (state.discuss) {
		const text = state.discussText.trim();
		return {
			...base,
			kind: "discuss",
			answer: null,
			...(state.discussReason ? { reason: state.discussReason } : {}),
			...(text ? { notes: text } : {}),
		};
	}
	if (question.multiSelect) {
		const valid = state.multi.filter((label) => question.options.some((o) => o.label === label));
		const custom = state.customActive ? state.customText.trim() : "";
		if (valid.length === 0 && !custom) return null;
		const noteLines = valid.flatMap((label) => {
			const note = state.notes[label]?.trim();
			return note ? [`${splitRecommended(label).text}: ${note}`] : [];
		});
		return {
			...base,
			kind: "multi",
			answer: custom || null,
			selected: valid,
			...(noteLines.length > 0 ? { notes: noteLines.join("\n") } : {}),
		};
	}
	if (state.customActive && state.customText.trim()) {
		return { ...base, kind: "custom", answer: state.customText.trim() };
	}
	if (state.option != null) {
		const opt = question.options.find((o) => o.label === state.option);
		if (!opt) return null;
		const note = state.notes[state.option]?.trim();
		return {
			...base,
			kind: "option",
			answer: state.option,
			...previewEcho(opt),
			...(note ? { notes: note } : {}),
		};
	}
	return null;
}

export function deriveAnswers(
	questions: AskUserQuestionItem[],
	states: Record<number, QState>,
): AskUserQuestionAnswer[] {
	return questions
		.map((question, index) => deriveAnswer(question, index, states[index] ?? emptyQState()))
		.filter((answer): answer is AskUserQuestionAnswer => answer != null);
}

export function hasPreview(target: {
	preview?: string | undefined;
	previewFile?: string | undefined;
}): boolean {
	return !!target.previewFile || !!target.preview?.trim();
}

export interface RecapState {
	selectedLabels: string[];
	customAnswer: string | null;
}

export function deriveRecapState(answer: AskUserQuestionAnswer | undefined): RecapState {
	const selectedLabels =
		answer?.kind === "multi"
			? (answer.selected ?? [])
			: answer?.kind === "option" && answer.answer
				? [answer.answer]
				: [];
	const customAnswer =
		answer && (answer.kind === "custom" || answer.kind === "multi") ? answer.answer : null;
	return { selectedLabels, customAnswer };
}

export type ChoiceKeyAction =
	| { type: "move"; index: number }
	| { type: "select" }
	| { type: "note" }
	| { type: "discuss" }
	| { type: "none" };

export function choiceKeyAction(
	key: string,
	index: number,
	count: number,
	otherIndex: number,
): ChoiceKeyAction {
	if (count <= 0) return { type: "none" };
	if (key === "ArrowDown") return { type: "move", index: (index + 1) % count };
	if (key === "ArrowUp") return { type: "move", index: (index - 1 + count) % count };
	if (key === "Home") return { type: "move", index: 0 };
	if (key === "End") return { type: "move", index: otherIndex };
	if (key === "Enter") return { type: "select" };
	if (key === " " || key === "Spacebar") return { type: "note" };
	if (key === "d") return { type: "discuss" };
	return { type: "none" };
}

export function paneOptionIndex(
	question: AskUserQuestionItem,
	state: QState,
	cursor: number,
): number | null {
	if (cursor >= 0 && cursor < question.options.length) return cursor;
	if (state.customActive) return null;
	const picked = question.options.findIndex((option) => option.label === state.option);
	return picked >= 0 ? picked : null;
}

export function customTextPatch(text: string): Partial<QState> {
	return text.trim()
		? { customText: text, customActive: true, option: null, discuss: false }
		: { customText: text, customActive: false };
}

export function toggleCustomPatch(state: QState): Partial<QState> {
	const on = !state.customActive;
	return { customActive: on, ...(on && state.discuss ? { discuss: false } : {}) };
}

export function discussReasonPatch(
	state: QState,
	reason: AskUserQuestionDiscussReason,
): Partial<QState> {
	return { discuss: true, discussReason: state.discussReason === reason ? null : reason };
}

export function selectOptionPatch(state: QState, label: string, cursor: number): Partial<QState> {
	const from =
		state.option ?? Object.keys(state.notes).find((key) => !!state.notes[key]?.trim()) ?? null;
	const carried = from != null && from !== label ? state.notes[from] : undefined;
	const notes =
		carried?.trim() && !state.notes[label]?.trim()
			? Object.fromEntries([
					...Object.entries(state.notes).filter(([key]) => key !== from),
					[label, carried],
				])
			: undefined;
	return {
		cursor,
		option: label,
		customActive: false,
		...(notes ? { notes } : {}),
		...(state.noteFor != null && state.noteFor !== label ? { noteFor: null } : {}),
		...(state.discuss ? { discuss: false } : {}),
	};
}

export function toggleMultiPatch(state: QState, label: string, cursor: number): Partial<QState> {
	const removing = state.multi.includes(label);
	return {
		cursor,
		multi: removing ? state.multi.filter((item) => item !== label) : [...state.multi, label],
		...(removing && state.noteFor === label ? { noteFor: null } : {}),
		...(state.discuss ? { discuss: false } : {}),
	};
}

export function openNotePatch(
	state: QState,
	multiSelect: boolean,
	label: string,
	cursor: number,
): Partial<QState> {
	if (!multiSelect) return { ...selectOptionPatch(state, label, cursor), noteFor: label };
	return {
		cursor,
		noteFor: label,
		...(state.multi.includes(label) ? {} : { multi: [...state.multi, label] }),
		...(state.discuss ? { discuss: false } : {}),
	};
}

export function fieldKeyAction(
	event: {
		key: string;
		shiftKey: boolean;
		altKey: boolean;
		ctrlKey: boolean;
		metaKey: boolean;
	},
	isComposing: boolean,
): "finish" | "consume" | "none" {
	if (event.key === "Escape") return isComposing ? "consume" : "finish";
	if (isComposing) return "none";
	const modified = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
	if (event.key === "Enter" && !modified) return "finish";
	return "none";
}

export interface ChoiceNudge {
	question: number;
	seq: number;
}

export function nudgeShowsOnPage(
	nudge: ChoiceNudge | null,
	page: number,
	answered: boolean,
): boolean {
	return !!nudge && nudge.question === page && !answered;
}

export function questionPageForKey(key: string, current: number, last: number): number | null {
	if (key === "ArrowLeft") return Math.max(0, current - 1);
	if (key === "ArrowRight") return Math.min(last, current + 1);
	return null;
}
