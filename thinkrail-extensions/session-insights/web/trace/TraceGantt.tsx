import { cn } from "@thinkrail/ui/utils";
import { useEffect, useRef, useState } from "react";
import type { BandPick } from "./bands";
import { ROW_HEIGHT } from "./frame";
import { bandAt, GanttEngine, type GanttState, type GanttText, headerHeight } from "./gantt";
import type { Palette } from "./palette";
import {
	type BrushGrip,
	brushClick,
	brushDrag,
	brushGrip,
	panView,
	type View,
	WHEEL_ZOOM,
	zoomView,
} from "./scale";

const DRAG_THRESHOLD = 4;

/** The header's height by its bands (overview + axis, plus a plan and a skill band). */
export const HEADER_CLASS: Readonly<Record<number, string>> = {
	50: "h-50",
	68: "h-68",
	86: "h-86",
};

interface Drag {
	x0: number;
	y0: number;
	view: View;
	scrollTop: number;
	moved: boolean;
}

function unitAt(view: View, width: number, x: number): number {
	return view.u0 + (x / Math.max(1, width)) * (view.u1 - view.u0);
}

/**
 * The Gantt column: header canvas (overview brush and axis) above the body and overlay canvases. Canvas
 * is `aria-hidden`; the tree carries the semantics and the keyboard, and the canvas mirrors its selection.
 */
export function TraceGantt({
	state,
	palette,
	text,
	scroller,
	onSelect,
	onView,
	onZoomRow,
	onPick,
}: {
	state: GanttState;
	palette: Palette | null;
	text: GanttText;
	scroller: HTMLElement | null;
	onSelect: (index: number) => void;
	onView: (view: View) => void;
	onZoomRow: (index: number) => void;
	onPick: (pick: BandPick) => void;
}) {
	const bodyRef = useRef<HTMLCanvasElement>(null);
	const overlayRef = useRef<HTMLCanvasElement>(null);
	const headerRef = useRef<HTMLCanvasElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	const [engine, setEngine] = useState<GanttEngine | null>(null);
	const [width, setWidth] = useState(0);
	const latest = useRef({ state, onSelect, onView, onZoomRow, onPick, width });

	useEffect(() => {
		latest.current = { state, onSelect, onView, onZoomRow, onPick, width };
	});

	useEffect(() => {
		const body = bodyRef.current;
		const overlay = overlayRef.current;
		const header = headerRef.current;
		if (!body || !overlay || !header) return;
		const created = new GanttEngine(body, overlay, header);
		setEngine(created);
		return () => created.dispose();
	}, []);

	useEffect(() => {
		engine?.setState(state);
	}, [engine, state]);

	useEffect(() => {
		if (engine && palette) engine.setPalette(palette, text);
	}, [engine, palette, text]);

	useEffect(() => {
		const box = boxRef.current;
		if (!box || !engine) return;
		const measure = () => {
			const next = box.clientWidth;
			setWidth(next);
			engine.setSize(next, box.clientHeight, window.devicePixelRatio || 1);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(box);
		return () => observer.disconnect();
	}, [engine]);

	useEffect(() => {
		if (!scroller || !engine) return;
		const sync = () => engine.setScroll(scroller.scrollTop);
		sync();
		scroller.addEventListener("scroll", sync, { passive: true });
		return () => scroller.removeEventListener("scroll", sync);
	}, [engine, scroller]);

	useEffect(() => {
		const body = overlayRef.current;
		const header = headerRef.current;
		if (!body || !header || !engine) return;
		let drag: Drag | null = null;
		let brush: BrushGrip | null = null;
		let picking: BandPick | null = null;
		const local = (event: { clientX: number; clientY: number }, element: HTMLElement) => {
			const rect = element.getBoundingClientRect();
			return { x: event.clientX - rect.left, y: event.clientY - rect.top };
		};
		const onWheel = (event: WheelEvent) => {
			const { state: current, onView: setView, width: w } = latest.current;
			const { x } = local(event, body);
			const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
			if (event.ctrlKey || event.metaKey || event.altKey) {
				event.preventDefault();
				setView(
					zoomView(
						current.scale,
						current.view,
						unitAt(current.view, w, x),
						Math.exp(delta * WHEEL_ZOOM),
					),
				);
				return;
			}
			if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
				event.preventDefault();
				const dx = event.shiftKey ? delta : event.deltaX;
				setView(
					panView(
						current.scale,
						current.view,
						(dx / Math.max(1, w)) * (current.view.u1 - current.view.u0),
					),
				);
				return;
			}
			if (scroller) {
				event.preventDefault();
				scroller.scrollTop += delta;
			}
		};
		const onHeaderWheel = (event: WheelEvent) => {
			event.preventDefault();
			const { state: current, onView: setView, width: w } = latest.current;
			const { x } = local(event, header);
			const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
			if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
				const dx = event.shiftKey ? delta : event.deltaX;
				setView(
					panView(
						current.scale,
						current.view,
						(dx / Math.max(1, w)) * (current.view.u1 - current.view.u0),
					),
				);
			} else
				setView(
					zoomView(
						current.scale,
						current.view,
						unitAt(current.view, w, x),
						Math.exp(delta * WHEEL_ZOOM),
					),
				);
		};
		const onDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			const { x, y } = local(event, body);
			drag = {
				x0: x,
				y0: y,
				view: latest.current.state.view,
				scrollTop: scroller?.scrollTop ?? 0,
				moved: false,
			};
			body.setPointerCapture(event.pointerId);
		};
		const onMove = (event: PointerEvent) => {
			const { x, y } = local(event, body);
			const { state: current, onView: setView, width: w } = latest.current;
			if (drag) {
				if (Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > DRAG_THRESHOLD) drag.moved = true;
				if (drag.moved) {
					const units = ((x - drag.x0) / Math.max(1, w)) * (drag.view.u1 - drag.view.u0);
					setView(panView(current.scale, drag.view, -units));
					if (scroller) scroller.scrollTop = drag.scrollTop - (y - drag.y0);
				}
			}
			const row = Math.floor((y + (scroller?.scrollTop ?? 0)) / ROW_HEIGHT);
			engine.setHover(row >= 0 && row < current.rows.length ? { row, x } : null);
		};
		const onUp = (event: PointerEvent) => {
			const done = drag;
			drag = null;
			if (body.hasPointerCapture(event.pointerId)) body.releasePointerCapture(event.pointerId);
			if (!done || done.moved) return;
			const { x, y } = local(event, body);
			const hit = engine.hitAt(x, y);
			if (hit) latest.current.onSelect(hit.event);
		};
		const onLeave = () => engine.setHover(null);
		const onDouble = (event: MouseEvent) => {
			const { x, y } = local(event, body);
			const hit = engine.hitAt(x, y);
			if (hit) latest.current.onZoomRow(hit.event);
		};
		const onHeaderDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			const { x, y } = local(event, header);
			const { state: current, width: w } = latest.current;
			const band = bandAt(current.bands, y)?.band.key;
			if (band === "plan" || band === "skills") {
				picking = engine.bandHit(x, y);
				return;
			}
			if (band !== "overview") return;
			brush = brushGrip(current.scale, current.view, w, x);
			header.setPointerCapture(event.pointerId);
		};
		const onHeaderMove = (event: PointerEvent) => {
			const { x, y } = local(event, header);
			engine.setHover(null);
			const pick = engine.bandHit(x, y);
			engine.setBandHover(pick ? { x, pick } : null);
			header.dataset.band = pick ? "true" : "false";
			if (!brush) return;
			const { state: current, onView: setView, width: w } = latest.current;
			const next = brushDrag(current.scale, current.view, w, brush, x);
			if (next) setView(next);
		};
		const onHeaderUp = (event: PointerEvent) => {
			const { x, y } = local(event, header);
			const picked = picking;
			picking = null;
			const pick = picked ? engine.bandHit(x, y) : null;
			if (picked && pick && pick.kind === picked.kind) latest.current.onPick(pick);
			const done = brush;
			brush = null;
			if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
			if (!done) return;
			const { state: current, onView: setView, width: w } = latest.current;
			const next = brushClick(current.scale, current.view, w, done);
			if (next) setView(next);
		};
		body.addEventListener("wheel", onWheel, { passive: false });
		body.addEventListener("pointerdown", onDown);
		body.addEventListener("pointermove", onMove);
		body.addEventListener("pointerup", onUp);
		body.addEventListener("pointerleave", onLeave);
		body.addEventListener("dblclick", onDouble);
		header.addEventListener("wheel", onHeaderWheel, { passive: false });
		header.addEventListener("pointerdown", onHeaderDown);
		header.addEventListener("pointermove", onHeaderMove);
		header.addEventListener("pointerup", onHeaderUp);
		const onHeaderLeave = () => engine.setBandHover(null);
		header.addEventListener("pointerleave", onHeaderLeave);
		return () => {
			header.removeEventListener("pointerleave", onHeaderLeave);
			body.removeEventListener("wheel", onWheel);
			body.removeEventListener("pointerdown", onDown);
			body.removeEventListener("pointermove", onMove);
			body.removeEventListener("pointerup", onUp);
			body.removeEventListener("pointerleave", onLeave);
			body.removeEventListener("dblclick", onDouble);
			header.removeEventListener("wheel", onHeaderWheel);
			header.removeEventListener("pointerdown", onHeaderDown);
			header.removeEventListener("pointermove", onHeaderMove);
			header.removeEventListener("pointerup", onHeaderUp);
		};
	}, [engine, scroller]);

	return (
		<div aria-hidden="true" className="flex h-full min-h-0 flex-col" data-testid="trace-gantt">
			<div
				className={cn(
					"relative shrink-0 border-border-default border-b bg-container-header-bg",
					HEADER_CLASS[headerHeight(state.bands)] ?? "h-50",
				)}
			>
				<canvas
					ref={headerRef}
					data-testid="trace-axis"
					className="absolute inset-0 size-full cursor-crosshair data-[band=true]:cursor-pointer"
				/>
			</div>
			<div ref={boxRef} className="relative min-h-0 flex-1">
				<canvas ref={bodyRef} data-testid="trace-canvas" className="absolute inset-0 size-full" />
				<canvas ref={overlayRef} className="absolute inset-0 size-full" />
			</div>
		</div>
	);
}
