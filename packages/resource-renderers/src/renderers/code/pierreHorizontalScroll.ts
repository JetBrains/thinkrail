import type { FileDiff, PostRenderPhase } from "@pierre/diffs";
import { useCallback, useEffect, useRef } from "react";

type ScrollInstance = Pick<FileDiff<unknown>, "getCodeScrollLeft" | "setCodeScrollLeft">;

export function connectHorizontalScroll(
	bar: HTMLDivElement,
	sizer: HTMLElement,
	columns: HTMLElement[],
	instance: ScrollInstance,
) {
	let offset = instance.getCodeScrollLeft();
	let maximum = 0;
	let ignoreChange = false;
	const limits = new Map<HTMLElement, number>();
	const expected = new Map<HTMLElement, number>();
	const write = (value: number) => {
		offset = Math.max(0, Math.min(maximum, value));
		for (const code of columns) expected.set(code, Math.min(offset, limits.get(code) ?? 0));
		ignoreChange = true;
		try {
			bar.scrollLeft = offset;
			instance.setCodeScrollLeft(offset);
		} finally {
			ignoreChange = false;
		}
	};
	const measure = () => {
		for (const code of columns) limits.set(code, Math.max(0, code.scrollWidth - code.clientWidth));
		maximum = Math.max(0, ...limits.values());
		bar.hidden = maximum <= 1;
		sizer.style.width = `${bar.clientWidth + maximum}px`;
		write(offset);
	};
	const fromBar = () => {
		if (!ignoreChange && Math.abs(bar.scrollLeft - offset) > 0.5) write(bar.scrollLeft);
	};
	const fromCode = (event: Event) => {
		event.stopImmediatePropagation();
		const code = event.currentTarget as HTMLElement;
		if (!ignoreChange && Math.abs(code.scrollLeft - (expected.get(code) ?? 0)) > 0.5) {
			const value = code.scrollLeft;
			const limit = Math.max(0, code.scrollWidth - code.clientWidth);
			if (limit !== limits.get(code)) {
				// Layout can clamp a column before ResizeObserver delivers its measurement.
				// Only unexpected column input reads geometry; controller drags and echoes do not.
				const clamped = Math.min(offset, limit);
				measure();
				if (Math.abs(value - clamped) <= 0.5) return;
			}
			write(value);
		}
	};
	bar.addEventListener("scroll", fromBar, { passive: true });
	const resize = new ResizeObserver(measure);
	resize.observe(bar);
	for (const code of columns) {
		code.addEventListener("scroll", fromCode, { passive: true, capture: true });
		resize.observe(code);
	}
	measure();
	return {
		measure,
		release() {
			resize.disconnect();
			bar.removeEventListener("scroll", fromBar);
			for (const code of columns) code.removeEventListener("scroll", fromCode, true);
		},
	};
}

export function usePierreHorizontalScroll() {
	const barRef = useRef<HTMLDivElement | null>(null);
	const connectionRef = useRef<
		| {
				bar: HTMLDivElement;
				instance: ScrollInstance;
				columns: HTMLElement[];
				measure: () => void;
				release: () => void;
		  }
		| undefined
	>(undefined);
	const retryFrameRef = useRef<number | null>(null);
	const attach = useCallback((node: HTMLElement, instance: ScrollInstance) => {
		const bar = barRef.current;
		const sizer = bar?.firstElementChild;
		if (!bar || !(sizer instanceof HTMLElement)) return false;
		const columns = Array.from(
			node.shadowRoot?.querySelectorAll<HTMLElement>(
				"code[data-deletions], code[data-additions], code[data-unified]",
			) ?? [],
		);
		const current = connectionRef.current;
		if (
			current &&
			current.bar === bar &&
			current.instance === instance &&
			current.columns.length === columns.length &&
			current.columns.every((code, i) => code === columns[i])
		) {
			current.measure();
			return true;
		}
		current?.release();
		connectionRef.current = {
			bar,
			instance,
			columns,
			...connectHorizontalScroll(bar, sizer, columns, instance),
		};
		return true;
	}, []);
	const onPostRender = useCallback(
		(node: HTMLElement, instance: ScrollInstance, phase: PostRenderPhase) => {
			if (phase === "unmount") {
				if (retryFrameRef.current !== null) cancelAnimationFrame(retryFrameRef.current);
				retryFrameRef.current = null;
				connectionRef.current?.release();
				connectionRef.current = undefined;
				return;
			}
			if (attach(node, instance)) return;
			if (retryFrameRef.current !== null) cancelAnimationFrame(retryFrameRef.current);
			retryFrameRef.current = requestAnimationFrame(() => {
				retryFrameRef.current = null;
				attach(node, instance);
			});
		},
		[attach],
	);
	useEffect(
		() => () => {
			if (retryFrameRef.current !== null) cancelAnimationFrame(retryFrameRef.current);
			connectionRef.current?.release();
			connectionRef.current = undefined;
		},
		[],
	);
	return { barRef, onPostRender };
}
