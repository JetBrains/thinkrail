import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionOption } from "./core.ts";

export interface QuestionState {
	option: string | null;
	customText: string;
	customActive: boolean;
	multi: string[];
	notes: Record<string, string>;
}

export function emptyQuestionState(): QuestionState {
	return { option: null, customText: "", customActive: false, multi: [], notes: {} };
}

export function splitRecommended(label: string): { text: string; recommended: boolean } {
	const match = /\s*\(recommended\)\s*$/i.exec(label);
	return match
		? { text: label.slice(0, match.index).trim(), recommended: true }
		: { text: label, recommended: false };
}

export function readRecommendation(option: AskUserQuestionOption): {
	text: string;
	recommended: boolean;
	reason: string | undefined;
} {
	const { text, recommended } = splitRecommended(option.label);
	const reason = option.recommendedReason?.trim() || undefined;
	return { text, recommended: recommended || !!reason, reason };
}

export function deriveAnswer(
	question: AskUserQuestionItem,
	index: number,
	state: QuestionState,
): AskUserQuestionAnswer | null {
	const base = { questionIndex: index, question: question.question };
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
		const option = question.options.find((o) => o.label === state.option);
		if (!option) return null;
		const note = state.notes[state.option]?.trim();
		return {
			...base,
			kind: "option",
			answer: state.option,
			...(option.preview ? { preview: option.preview } : {}),
			...(note ? { notes: note } : {}),
		};
	}
	return null;
}

export function deriveAnswers(
	questions: readonly AskUserQuestionItem[],
	states: readonly QuestionState[],
): AskUserQuestionAnswer[] {
	return questions
		.map((question, index) => deriveAnswer(question, index, states[index] ?? emptyQuestionState()))
		.filter((answer): answer is AskUserQuestionAnswer => answer != null);
}

export function answerSummary(answer: AskUserQuestionAnswer): string {
	if (answer.kind === "custom") return `“${answer.answer ?? ""}”`;
	if (answer.kind === "option") return splitRecommended(answer.answer ?? "").text;
	const selected = (answer.selected ?? []).map((label) => splitRecommended(label).text);
	if (answer.answer) selected.push(`“${answer.answer}”`);
	return selected.join(", ");
}
