import { useCallback, useEffect, useReducer } from "react";
import type { ResourceContent } from "@/resources";

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
	selection: { stamp: string; value: T } | null;
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
			selection: { stamp: action.stamp, value: action.value },
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

export function useStampedComposer<T>(stamp: string) {
	const [state, dispatch] = useReducer(
		stampedComposerReducer<T>,
		undefined,
		initialStampedComposerState<T>,
	);
	const selectionIsCurrent = state.selection?.stamp === stamp;

	useEffect(() => {
		dispatch({ type: "refresh", stamp });
	}, [stamp]);

	const select = useCallback(
		(value: T, composing = true) => {
			dispatch({ type: "select", stamp, value, composing });
		},
		[stamp],
	);
	const open = useCallback(() => dispatch({ type: "open", stamp }), [stamp]);
	const close = useCallback(() => dispatch({ type: "close" }), []);

	return {
		selection: selectionIsCurrent ? (state.selection?.value ?? null) : null,
		composing: state.composing && selectionIsCurrent,
		stale: state.stale || (state.composing && !selectionIsCurrent),
		select,
		open,
		close,
	};
}
