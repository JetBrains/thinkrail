import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResourceContent } from "@/resources";
import {
	type ReviewTextBinding,
	type ReviewTextState,
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
	input?: ReviewTextState;
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
	const [restoredSelection] = useState(state.selection);
	const selectionIsCurrent = state.selection?.stamp === stamp;

	useEffect(() => {
		change((current) => stampedComposerReducer(current, { type: "refresh", stamp }));
	}, [change, stamp]);

	const select = useCallback(
		(value: T, composing = true) => {
			change((current) =>
				stampedComposerReducer(current, { type: "select", stamp, value, composing }),
			);
		},
		[change, stamp],
	);
	const open = useCallback(
		() => change((current) => stampedComposerReducer(current, { type: "open", stamp })),
		[change, stamp],
	);
	const selection = state.selection;
	const close = useCallback(
		() => change((current) => (current.selection === selection ? undefined : current)),
		[change, selection],
	);
	const onInputChange = useCallback(
		(input: ReviewTextState) =>
			change((current) => (current.selection === selection ? { ...current, input } : current)),
		[change, selection],
	);
	const input: ReviewTextBinding | undefined = scoped
		? { value: state.input, onChange: onInputChange, restored: selection === restoredSelection }
		: undefined;

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
