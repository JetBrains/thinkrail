import { Minus, Plus, RotateCcw } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";

const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

function clamp(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * A scrollable, zoomable, drag-to-pan viewport for a rendered SVG string — used inside the diagram
 * full-screen dialog. Plain wheel / trackpad scrolls (both axes); Ctrl/⌘ + wheel and the buttons zoom;
 * dragging with the mouse pans. Zoom drives the SVG's rendered width (via a CSS var), so the overflow
 * container gets real scrollbars in both directions when the diagram is larger than the viewport.
 */
export function PanZoomView({ svg }: { svg: string }) {
	const [scale, setScale] = useState(1);
	const scrollRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

	// Ctrl/⌘ + wheel zooms. Registered natively (non-passive) so we can preventDefault the browser's
	// page-zoom; plain wheel is left alone so it scrolls the container.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			setScale((s) => clamp(s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.pointerType !== "mouse") return; // touch/pen use native scrolling
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
		setScale(1);
		if (scrollRef.current) {
			scrollRef.current.scrollLeft = 0;
			scrollRef.current.scrollTop = 0;
		}
	};

	const btn =
		"rounded-[var(--radius-sm)] p-1 text-muted outline-none transition-colors hover:bg-hover hover:text-text focus-visible:ring-2 focus-visible:ring-primary";

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
				// biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid renders agent-provided source with securityLevel "strict"
				dangerouslySetInnerHTML={{ __html: svg }}
			/>
			<div className="absolute right-sm bottom-sm flex items-center gap-xs rounded-[var(--radius-sm)] border border-border2 bg-elevated p-1 text-xs shadow-[var(--shadow-lg)]">
				<button
					type="button"
					aria-label="Zoom out"
					data-testid="mermaid-zoom-out"
					onClick={() => setScale((s) => clamp(s / 1.25))}
					className={btn}
				>
					<Minus className="size-4" />
				</button>
				<span
					data-testid="mermaid-zoom-level"
					className="min-w-[3.5ch] text-center text-muted tabular-nums"
				>
					{Math.round(scale * 100)}%
				</span>
				<button
					type="button"
					aria-label="Zoom in"
					data-testid="mermaid-zoom-in"
					onClick={() => setScale((s) => clamp(s * 1.25))}
					className={btn}
				>
					<Plus className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Reset zoom"
					data-testid="mermaid-zoom-reset"
					onClick={reset}
					className={btn}
				>
					<RotateCcw className="size-3.5" />
				</button>
			</div>
		</div>
	);
}
