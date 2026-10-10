import {
	RiSubtractLine as Minus,
	RiAddLine as Plus,
	RiArrowGoBackLine as RotateCcw,
} from "@remixicon/react";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

function clamp(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function installPanZoomGestures(
	target: EventTarget,
	port: { getScale(): number; setScale(scale: number): void },
): () => void {
	let start: number | null = null;
	const onStart = (event: Event) => {
		if (event.defaultPrevented) return;
		start = port.getScale();
		event.preventDefault();
	};
	const onChange = (event: Event) => {
		if (start === null || event.defaultPrevented) return;
		event.preventDefault();
		const scale: unknown = Reflect.get(event, "scale");
		if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0) return;
		port.setScale(clamp(start * scale));
	};
	const onEnd = (event: Event) => {
		if (start === null) return;
		start = null;
		event.preventDefault();
	};
	target.addEventListener("gesturestart", onStart, { passive: false });
	target.addEventListener("gesturechange", onChange, { passive: false });
	target.addEventListener("gestureend", onEnd, { passive: false });
	return () => {
		target.removeEventListener("gesturestart", onStart);
		target.removeEventListener("gesturechange", onChange);
		target.removeEventListener("gestureend", onEnd);
	};
}

export function PanZoomView({ svg }: { svg: string }) {
	const [scale, setScale] = useState(1);
	const scaleRef = useRef(1);
	const scrollRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
	const setZoom = useCallback((next: number) => {
		const bounded = clamp(next);
		scaleRef.current = bounded;
		setScale(bounded);
	}, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			setZoom(scaleRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
		};
		const removeGestures = installPanZoomGestures(el, {
			getScale: () => scaleRef.current,
			setScale: setZoom,
		});
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			removeGestures();
			el.removeEventListener("wheel", onWheel);
		};
	}, [setZoom]);

	const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.pointerType !== "mouse") return;
		const el = scrollRef.current;
		if (!el) return;
		drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
		el.setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const el = scrollRef.current;
		const start = drag.current;
		if (!el || !start) return;
		el.scrollLeft = start.left - (e.clientX - start.x);
		el.scrollTop = start.top - (e.clientY - start.y);
	};
	const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		const el = scrollRef.current;
		if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
		drag.current = null;
	};

	const reset = () => {
		setZoom(1);
		if (scrollRef.current) {
			scrollRef.current.scrollLeft = 0;
			scrollRef.current.scrollTop = 0;
		}
	};

	const btn =
		"rounded-sm p-4 text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary";

	return (
		<div className="relative min-h-0 flex-1">
			<div
				ref={scrollRef}
				data-testid="mermaid-fullscreen-svg"
				className="h-full w-full cursor-grab select-none overflow-auto active:cursor-grabbing [&_svg]:!h-auto [&_svg]:!w-[var(--zoom)] [&_svg]:!max-w-none"
				style={{ "--zoom": `${scale * 100}%` } as React.CSSProperties}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
			<div className="absolute right-8 bottom-8 flex items-center gap-4 rounded-sm border border-border-default bg-container-elevated-bg p-4 tr-text-metadata shadow-[var(--shadow-lg)]">
				<button
					type="button"
					aria-label="Zoom out"
					data-testid="mermaid-zoom-out"
					onClick={() => setZoom(scaleRef.current / 1.25)}
					className={btn}
				>
					<Minus className="size-16" />
				</button>
				<span
					data-testid="mermaid-zoom-level"
					className="min-w-[3.5ch] text-center text-text-muted tabular-nums"
				>
					{Math.round(scale * 100)}%
				</span>
				<button
					type="button"
					aria-label="Zoom in"
					data-testid="mermaid-zoom-in"
					onClick={() => setZoom(scaleRef.current * 1.25)}
					className={btn}
				>
					<Plus className="size-16" />
				</button>
				<button
					type="button"
					aria-label="Reset zoom"
					data-testid="mermaid-zoom-reset"
					onClick={reset}
					className={btn}
				>
					<RotateCcw className="size-14" />
				</button>
			</div>
		</div>
	);
}
