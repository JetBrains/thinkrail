import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResourceContent } from "../registry";
import {
	type ReviewTextBinding,
	type ReviewTextState,
	useReviewDraftSlot,
	useReviewDraftState,
} from "./reviewDraftState";

export const FILE_CHANGED_NOTICE = "The file changed — select again.";

export function contentStamp(content: ResourceContent): string {
	return content.kind === "absent"
		? JSON.stringify(["absent"])
		: JSON.stringify([content.kind, content.hash]);
}

export function diffContentStamp(original: ResourceContent, modified: ResourceContent): string {
	return JSON.stringify([contentStamp(original), contentStamp(modified)]);
}

export interface StampedComposerState<T> {
	selection: { stamp: string; value: T; id: number } | null;
	composing: boolean;
	stale: boolean;
}

export type StampedComposerAction<T> =
	| { type: "select"; stamp: string; value: T; composing: boolean }
	| { type: "open"; stamp: string }
	| { type: "close" }
	| { type: "refresh"; stamp: string };

export function initialStampedComposerState<T>(): StampedComposerState<T> {
	return { selection: null, composing: false, stale: false };
}

export function stampedComposerReducer<T>(
	state: StampedComposerState<T>,
	action: StampedComposerAction<T>,
): StampedComposerState<T> {
	if (action.type === "select") {
		return {
			selection: { stamp: action.stamp, value: action.value, id: (state.selection?.id ?? 0) + 1 },
			composing: action.composing,
			stale: false,
		};
	}
	if (action.type === "open") {
		if (state.selection?.stamp !== action.stamp) return state;
		return { ...state, composing: true, stale: false };
	}
	if (action.type === "close") return initialStampedComposerState();
	if (!state.selection || state.selection.stamp === action.stamp) return state;
	return {
		selection: null,
		composing: false,
		stale: state.stale || state.composing,
	};
}

export function useStampedComposer<T>(stamp: string, slot = "selection") {
	const initial = useMemo(() => initialStampedComposerState<T>(), []);
	const [state, change, scoped] = useReviewDraftState(slot, initial, true);
	const selectionDraft = useReviewDraftSlot<StampedComposerState<T>>(slot, true);
	const textDraft = useReviewDraftSlot<ReviewTextState>(JSON.stringify(["text", slot]), true);
	const [restoredSelection] = useState(state.selection);
	const selectionIsCurrent = state.selection?.stamp === stamp;
	const selection = state.selection;

	const changeSelection = useCallback(
		(reduce: (current: StampedComposerState<T>) => StampedComposerState<T> | undefined) => {
			const before = selectionDraft?.read()?.selection ?? null;
			change(reduce);
			if ((selectionDraft?.read()?.selection ?? null) !== before)
				textDraft?.update(() => undefined);
		},
		[change, selectionDraft, textDraft],
	);

	useEffect(() => {
		changeSelection((current) => stampedComposerReducer(current, { type: "refresh", stamp }));
	}, [changeSelection, stamp]);

	const select = useCallback(
		(value: T, composing = true) => {
			changeSelection((current) =>
				stampedComposerReducer(current, { type: "select", stamp, value, composing }),
			);
		},
		[changeSelection, stamp],
	);
	const open = useCallback(
		() => changeSelection((current) => stampedComposerReducer(current, { type: "open", stamp })),
		[changeSelection, stamp],
	);
	const close = useCallback(
		() => changeSelection((current) => (current.selection === selection ? undefined : current)),
		[changeSelection, selection],
	);
	const onInputChange = useCallback(
		(input: ReviewTextState) => {
			if ((selectionDraft?.read()?.selection ?? null) === selection) textDraft?.update(() => input);
		},
		[selection, selectionDraft, textDraft],
	);
	const input = useMemo<ReviewTextBinding | undefined>(
		() =>
			textDraft
				? {
						read: textDraft.read,
						subscribe: textDraft.subscribe,
						onChange: onInputChange,
						restored: selection === restoredSelection,
					}
				: undefined,
		[onInputChange, restoredSelection, selection, textDraft],
	);

	return {
		input,
		key: scoped ? state.selection?.id : undefined,
		selection: selectionIsCurrent ? (state.selection?.value ?? null) : null,
		composing: state.composing && selectionIsCurrent,
		stale: state.stale || (state.composing && !selectionIsCurrent),
		select,
		open,
		close,
	};
}
