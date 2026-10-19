import { createContext, useCallback, useContext, useState } from "react";

export interface ReviewDraftPersistence {
	rendererId: string;
	values: Readonly<Record<string, unknown>> | undefined;
	update: (key: string, change: (current: unknown) => unknown) => void;
}

export const ReviewDraftContext = createContext<ReviewDraftPersistence | null>(null);

export function useReviewDraftState<T>(key: string, initial: T, rendererScoped = false) {
	const persistence = useContext(ReviewDraftContext);
	const [local, setLocal] = useState(initial);
	const slot = JSON.stringify([rendererScoped ? persistence?.rendererId : null, key]);
	const value = persistence ? ((persistence.values?.[slot] as T | undefined) ?? initial) : local;
	const update = persistence?.update;
	const change = useCallback(
		(reduce: (current: T) => T | undefined) => {
			if (update) {
				update(slot, (current) => {
					const next = reduce((current as T | undefined) ?? initial);
					return next === initial ? undefined : next;
				});
			} else {
				setLocal((current) => reduce(current) ?? initial);
			}
		},
		[initial, slot, update],
	);
	return [value, change, persistence !== null] as const;
}

export interface ReviewTextState {
	text: string;
	start: number;
	end: number;
	direction: "forward" | "backward" | "none";
	busy: boolean;
}

export interface ReviewTextBinding {
	value: ReviewTextState | undefined;
	onChange: (value: ReviewTextState) => void;
	restored?: boolean;
}

export function reviewTextState(text: string): ReviewTextState {
	return { text, start: text.length, end: text.length, direction: "none", busy: false };
}

export function selectedReviewText(
	input: HTMLTextAreaElement,
	state: ReviewTextState,
): ReviewTextState {
	const {
		value: text,
		selectionStart: start,
		selectionEnd: end,
		selectionDirection: direction,
	} = input;
	return state.text === text &&
		state.start === start &&
		state.end === end &&
		state.direction === direction
		? state
		: { ...state, text, start, end, direction };
}
