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
	const lastElementRef = useRef<T>(null);
	const initialStateRef = useRef(viewState);
	const restoredRef = useRef(false);
	const onViewStateRef = useRef(onViewState);
	onViewStateRef.current = onViewState;
	const attach = useCallback<RefCallback<T>>((node) => {
		elementRef.current = node;
		if (!node) return;
		lastElementRef.current = node;
		if (restoredRef.current) return;
		restoredRef.current = true;
		const top = scrollTop(initialStateRef.current);
		if (top !== null) node.scrollTop = top;
	}, []);
	useEffect(
		() => () => {
			if (lastElementRef.current) {
				onViewStateRef.current?.({ scrollTop: lastElementRef.current.scrollTop });
			}
		},
		[],
	);
	return { elementRef, attach };
}
