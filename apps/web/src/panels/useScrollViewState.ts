import { type RefCallback, type RefObject, useCallback, useEffect, useRef } from "react";

const TAKEOVER_EVENTS = ["wheel", "touchmove", "pointerdown", "keydown"] as const;

function scrollTop(state: unknown): number | null {
	if (typeof state !== "object" || state === null) return null;
	const value = Reflect.get(state, "scrollTop");
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function fits(node: HTMLElement, top: number): boolean {
	return node.scrollHeight - node.clientHeight + 1 >= top;
}

function restoreWhenFits(node: HTMLElement, top: number, onSettled: () => void): () => void {
	const stop = () => {
		resize.disconnect();
		children.disconnect();
		for (const type of TAKEOVER_EVENTS) node.removeEventListener(type, stop, true);
		onSettled();
	};
	const resize = new ResizeObserver(() => {
		if (!fits(node, top)) return;
		node.scrollTop = top;
		stop();
	});
	const observeChildren = () => {
		for (const child of node.children) resize.observe(child);
	};
	const children = new MutationObserver(observeChildren);
	observeChildren();
	children.observe(node, { childList: true });
	for (const type of TAKEOVER_EVENTS) {
		node.addEventListener(type, stop, { capture: true, passive: true });
	}
	return stop;
}

export function useScrollViewState<T extends HTMLElement>(
	viewState: unknown,
	onViewState: ((state: unknown) => void) | undefined,
): { elementRef: RefObject<T | null>; attach: RefCallback<T> } {
	const elementRef = useRef<T>(null);
	const savedTopRef = useRef(scrollTop(viewState));
	const pendingRef = useRef<(() => void) | null>(null);
	const onViewStateRef = useRef(onViewState);
	onViewStateRef.current = onViewState;
	const attach = useCallback<RefCallback<T>>((node) => {
		const previous = elementRef.current;
		const pending = pendingRef.current;
		pending?.();
		if (previous && previous !== node && !pending) savedTopRef.current = previous.scrollTop;
		elementRef.current = node;
		const top = savedTopRef.current;
		if (!node || top === null) return;
		node.scrollTop = top;
		if (fits(node, top)) return;
		pendingRef.current = restoreWhenFits(node, top, () => {
			pendingRef.current = null;
		});
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
