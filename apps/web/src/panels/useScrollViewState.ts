import { type RefCallback, type RefObject, useCallback, useEffect, useRef } from "react";

function scrollTop(state: unknown): number | null {
	if (typeof state !== "object" || state === null) return null;
	const value = Reflect.get(state, "scrollTop");
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function useScrollViewState<T extends HTMLElement>(
	viewState: unknown,
	onViewState: ((state: unknown) => void) | undefined,
): { elementRef: RefObject<T | null>; attach: RefCallback<T> } {
	const elementRef = useRef<T>(null);
	const savedTopRef = useRef(scrollTop(viewState));
	const onViewStateRef = useRef(onViewState);
	onViewStateRef.current = onViewState;
	const attach = useCallback<RefCallback<T>>((node) => {
		const previous = elementRef.current;
		if (previous && previous !== node) savedTopRef.current = previous.scrollTop;
		elementRef.current = node;
		if (node && savedTopRef.current !== null) node.scrollTop = savedTopRef.current;
	}, []);
	useEffect(
		() => () => {
			const top = elementRef.current?.scrollTop ?? savedTopRef.current;
			if (top !== null) onViewStateRef.current?.({ scrollTop: top });
		},
		[],
	);
	return { elementRef, attach };
}
