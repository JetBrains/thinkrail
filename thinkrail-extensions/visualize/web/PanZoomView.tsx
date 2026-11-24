import {
	RiSubtractLine as Minus,
	RiAddLine as Plus,
	RiArrowGoBackLine as RotateCcw,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import type * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

function clamp(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function clampInlinePan(viewport: HTMLDivElement, left: number, top: number): void {
	const drawing = viewport.firstElementChild;
	if (!drawing) return;
	const bounds = drawing.getBoundingClientRect();
	viewport.scrollLeft = Math.max(0, Math.min(left, bounds.width - viewport.clientWidth));
	viewport.scrollTop = Math.max(0, Math.min(top, bounds.height - viewport.clientHeight));
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

export function PanZoomView({
	svg,
	inline = false,
	actions,
}: {
	svg: string;
	inline?: boolean;
	actions?: React.ReactNode;
}) {
	const t = useT();
	const [scale, setScale] = useState(1);
	const scaleRef = useRef(1);
	const scrollRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
	const setZoom = useCallback((next: number) => {
		const bounded = clamp(next);
		scaleRef.current = bounded;
		setScale(bounded);
	}, []);

	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (inline && el) clampInlinePan(el, el.scrollLeft, el.scrollTop);
	}, [inline, scale, svg]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!inline || !el) return;
		const observer = new ResizeObserver(() => clampInlinePan(el, el.scrollLeft, el.scrollTop));
		observer.observe(el);
		if (el.firstElementChild) observer.observe(el.firstElementChild);
		return () => observer.disconnect();
	}, [inline, svg]);

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
		if (e.pointerType !== "mouse" || e.button !== 0) return;
		const el = scrollRef.current;
		if (!el) return;
		drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
		el.setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const el = scrollRef.current;
		const start = drag.current;
		if (!el || !start) return;
		const left = start.left - (e.clientX - start.x);
		const top = start.top - (e.clientY - start.y);
		if (inline) clampInlinePan(el, left, top);
		else {
			el.scrollLeft = left;
			el.scrollTop = top;
		}
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

	return (
		<div className={cn("relative", inline ? "max-w-full" : "min-h-0 flex-1")}>
			<div
				ref={scrollRef}
				data-testid={inline ? "mermaid-svg" : "mermaid-fullscreen-svg"}
				className={cn(
					"cursor-grab select-none active:cursor-grabbing",
					inline
						? "max-h-[min(60vh,480px)] overflow-hidden [&>svg]:block [&>svg]:h-auto [&>svg]:max-w-full [&>svg]:origin-top-left [&>svg]:scale-[var(--zoom)]"
						: "h-full w-full overflow-auto [&>svg]:!h-auto [&>svg]:!w-[var(--zoom)] [&>svg]:!max-w-none",
				)}
				style={{ "--zoom": inline ? scale : `${scale * 100}%` } as React.CSSProperties}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onLostPointerCapture={endDrag}
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
			<div
				className={cn(
					"flex items-center gap-4 rounded-sm border border-border-default bg-container-elevated-bg p-4 tr-text-metadata shadow-[var(--shadow-lg)]",
					inline ? "mt-4 ml-auto w-fit max-w-full flex-wrap" : "absolute right-8 bottom-8",
				)}
			>
				<IconButton
					icon={Minus}
					label={t("visualize.panZoom.zoomOut")}
					data-testid="mermaid-zoom-out"
					onClick={() => setZoom(scaleRef.current / 1.25)}
				/>
				<span
					data-testid="mermaid-zoom-level"
					className="min-w-[3.5ch] text-center text-text-muted tabular-nums"
				>
					{Math.round(scale * 100)}%
				</span>
				<IconButton
					icon={Plus}
					label={t("visualize.panZoom.zoomIn")}
					data-testid="mermaid-zoom-in"
					onClick={() => setZoom(scaleRef.current * 1.25)}
				/>
				<IconButton
					icon={RotateCcw}
					label={t("visualize.panZoom.reset")}
					data-testid="mermaid-zoom-reset"
					onClick={reset}
				/>
				{actions}
			</div>
		</div>
	);
}
