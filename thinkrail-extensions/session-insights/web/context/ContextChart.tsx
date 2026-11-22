import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type { ContextCall, SessionContext } from "@thinkrail/pi-session-insights/core";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { type ChartLabel, placeLabels, textMeasure } from "../chartLabels";
import { formatClock, formatCount, formatShare, formatTokens } from "../format";
import { keyLabels, PANEL_COMMANDS, PANEL_KEYS, PANEL_SCOPE, plainKey } from "../keys";
import { useCanvasLook } from "../trace/look";
import {
	CHART_HEIGHT,
	type ChartText,
	type ChartView,
	callAt,
	clampView,
	drawChart,
	drawOverview,
	fullView,
	LABEL_ROW,
	LABEL_ROWS,
	OVERVIEW_HEIGHT,
	panBy,
	positionAt,
	sizeCanvas,
	viewShowing,
	xOf,
	zoomAt,
} from "./chart";
import { CATEGORIES, CATEGORY_LABEL } from "./look";

const ZOOM_STEP = 1.6;
const CHART_KEYS = [PANEL_KEYS.zoomIn, PANEL_KEYS.zoomOut, PANEL_KEYS.zoomFit] as const;
const FIRST_LABEL_Y = 14;

/** The compaction and model-switch labels in view, compactions first, each with its shorter forms. */
export function markerLabels(
	t: Translator,
	data: SessionContext,
	view: ChartView,
	width: number,
): ChartLabel[] {
	const locale = localeOf(t);
	const indexOf = new Map(data.calls.map((call, at) => [call.id, at]));
	const xAt = (id: string | null) => {
		const at = id === null ? undefined : indexOf.get(id);
		if (at === undefined) return null;
		const x = xOf(view, width, at - 0.5);
		return x < 0 || x > width ? null : x;
	};
	const cliffs: ChartLabel[] = [];
	for (const cliff of data.compactions) {
		const x = xAt(cliff.after);
		if (x === null) continue;
		if (cliff.beforeTokens === null || cliff.afterTokens === null || cliff.change === null) {
			cliffs.push({ key: cliff.id, x, variants: [t("sessionInsights.context.cliffBare")] });
			continue;
		}
		const before = formatTokens(locale, cliff.beforeTokens);
		const after = formatTokens(locale, cliff.afterTokens);
		const change = `${cliff.change < 0 ? "−" : "+"}${formatShare(locale, Math.abs(cliff.change), 1) ?? ""}`;
		cliffs.push({
			key: cliff.id,
			x,
			variants: [
				t("sessionInsights.context.cliff", { before, after, change }),
				t("sessionInsights.context.cliffShort", { before, after }),
				change,
			],
		});
	}
	const switches: ChartLabel[] = [];
	for (const change of data.switches) {
		const x = xAt(change.at);
		if (x === null) continue;
		const model = change.to ?? "—";
		const short = model.split("/").pop() ?? model;
		switches.push({
			key: `switch:${change.at}`,
			x,
			variants: [
				t("sessionInsights.context.switch", { model }),
				...(short !== model ? [t("sessionInsights.context.switch", { model: short })] : []),
			],
		});
	}
	const byX = (a: ChartLabel, b: ChartLabel) => a.x - b.x;
	return [...cliffs.sort(byX), ...switches.sort(byX)];
}

/** Each compaction's drop and each model switch, as SVG text over the canvas so it reads like text. */
function Markers({
	data,
	view,
	width,
	font,
}: {
	data: SessionContext;
	view: ChartView;
	width: number;
	font: string;
}) {
	const t = useT();
	const measure = useMemo(() => textMeasure(font), [font]);
	if (width <= 0) return null;
	const placed = placeLabels(markerLabels(t, data, view, width), {
		width,
		rows: LABEL_ROWS,
		measure,
	});
	return (
		<svg
			aria-hidden="true"
			width="100%"
			height={CHART_HEIGHT}
			className="pointer-events-none absolute inset-x-0 top-0 block"
		>
			{placed.map((label) => {
				const cliff = !label.key.startsWith("switch:");
				return (
					<text
						key={label.key}
						data-testid={cliff ? "context-cliff" : "context-switch"}
						data-level={label.level}
						x={label.x}
						y={FIRST_LABEL_Y + label.row * LABEL_ROW}
						textAnchor={label.anchor}
						className={`${cliff ? "fill-series-7" : "fill-series-3"} tr-text-caption`}
					>
						{label.text}
					</text>
				);
			})}
		</svg>
	);
}

/**
 * The composition bars of every call with the cache strip and a brushable overview. Ctrl/⌘/Alt+wheel
 * zooms at the pointer, Shift+wheel and drag pan, a click selects a call and a double click shows all;
 * the canvas is `aria-hidden` and a visually hidden button carries the keys.
 */
export function ContextChart({
	sessionId,
	data,
	selected,
	onSelect,
}: {
	sessionId: string;
	data: SessionContext;
	selected: number | null;
	onSelect: (index: number) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const local = useLocalKeys(PANEL_SCOPE, PANEL_COMMANDS);
	const [root, setRoot] = useState<HTMLDivElement | null>(null);
	const { palette, font } = useCanvasLook(root);
	const chartRef = useRef<HTMLCanvasElement>(null);
	const overviewRef = useRef<HTMLCanvasElement>(null);
	const [width, setWidth] = useState(0);
	const count = data.calls.length;
	const [view, setView] = useState<ChartView>(() => fullView(count));
	const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
	const live = useRef({ view, width, count, onSelect });
	useEffect(() => {
		live.current = { view, width, count, onSelect };
	});

	useEffect(() => {
		if (!root) return;
		const measure = () => setWidth(root.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(root);
		return () => observer.disconnect();
	}, [root]);

	useEffect(() => {
		if (selected !== null) setView((current) => viewShowing(current, count, selected));
	}, [count, selected]);

	const text: ChartText = useMemo(
		() => ({
			font,
			tokens: (value) => formatTokens(locale, value),
			call: (n) => t("sessionInsights.context.callShort", { n }),
			cacheRow: t("sessionInsights.context.cacheRow"),
			missRow: t("sessionInsights.context.missRow"),
			offScale: (windows) =>
				t("sessionInsights.context.offScale", {
					window: windows.map((value) => formatTokens(locale, value)).join(" · "),
				}),
			tooltip: (call: ContextCall) => {
				const lines = [
					t("sessionInsights.context.callTitle", { n: call.n, model: call.model ?? "—" }),
					`${formatClock(locale, call.t, true)} · ${t("sessionInsights.context.exact", { tokens: formatCount(locale, call.total) })}`,
					t("sessionInsights.context.cacheSplit", {
						read: formatTokens(locale, call.cacheRead),
						write: formatTokens(locale, call.cacheWrite),
						input: formatTokens(locale, call.input),
					}),
				];
				CATEGORIES.forEach((category, at) => {
					const value = call.parts[at] ?? 0;
					if (value > 0)
						lines.push(`≈ ${t(CATEGORY_LABEL[category])}: ${formatTokens(locale, value)}`);
				});
				if (call.miss) lines.push(t("sessionInsights.context.missLine"));
				return lines;
			},
		}),
		[font, locale, t],
	);

	useEffect(() => {
		const canvas = chartRef.current;
		if (!canvas || !palette || width <= 0) return;
		const context = sizeCanvas(canvas, width, CHART_HEIGHT);
		if (context) drawChart(context, width, data, view, palette, text, { selected, hover });
	}, [data, hover, palette, selected, text, view, width]);

	useEffect(() => {
		const canvas = overviewRef.current;
		if (!canvas || !palette || width <= 0) return;
		const context = sizeCanvas(canvas, width, OVERVIEW_HEIGHT);
		if (context) drawOverview(context, width, data, view, palette);
	}, [data, palette, view, width]);

	useEffect(() => {
		const canvas = chartRef.current;
		const overview = overviewRef.current;
		if (!canvas || !overview) return;
		let drag: { x: number; view: ChartView; moved: boolean } | null = null;
		let brush: number | null = null;
		const local = (event: PointerEvent | WheelEvent | MouseEvent, element: HTMLElement) => {
			const box = element.getBoundingClientRect();
			return { x: event.clientX - box.left, y: event.clientY - box.top };
		};
		const onWheel = (event: WheelEvent) => {
			const { view: current, width: w, count: n } = live.current;
			const { x } = local(event, canvas);
			if (event.ctrlKey || event.metaKey || event.altKey) {
				event.preventDefault();
				const factor = Math.exp(-event.deltaY * 0.0016);
				setView(zoomAt(current, n, positionAt(current, w, x), factor));
			} else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
				event.preventDefault();
				const delta = event.shiftKey ? event.deltaY : event.deltaX;
				const span = current.v1 - current.v0;
				setView(panBy(current, n, (delta / Math.max(1, w)) * span));
			}
		};
		const onDown = (event: PointerEvent) => {
			drag = { x: local(event, canvas).x, view: live.current.view, moved: false };
			canvas.setPointerCapture(event.pointerId);
		};
		const onMove = (event: PointerEvent) => {
			const { x, y } = local(event, canvas);
			const { view: current, width: w, count: n } = live.current;
			if (drag) {
				if (Math.abs(x - drag.x) > 3) drag.moved = true;
				if (drag.moved) {
					const span = drag.view.v1 - drag.view.v0;
					setView(panBy(drag.view, n, (-(x - drag.x) / Math.max(1, w - 64)) * span));
					return;
				}
			}
			const index = callAt(current, w, x, data.calls);
			setHover(index === null ? null : { index, x, y });
		};
		const onUp = (event: PointerEvent) => {
			const started = drag;
			drag = null;
			if (!started || started.moved) return;
			const { view: current, width: w } = live.current;
			const index = callAt(current, w, local(event, canvas).x, data.calls);
			if (index !== null) live.current.onSelect(index);
		};
		const onLeave = () => setHover(null);
		const onDouble = () => setView(fullView(live.current.count));
		const brushTo = (x: number) => {
			const { width: w, count: n } = live.current;
			const full = fullView(n);
			const start = brush ?? x;
			const a = positionAt(full, w, Math.min(start, x));
			const b = positionAt(full, w, Math.max(start, x));
			if (b - a < 1) {
				const span = live.current.view.v1 - live.current.view.v0;
				setView(clampView({ v0: a - span / 2, v1: a + span / 2 }, n));
			} else setView(clampView({ v0: a, v1: b }, n));
		};
		const onBrushDown = (event: PointerEvent) => {
			brush = local(event, overview).x;
			overview.setPointerCapture(event.pointerId);
		};
		const onBrushMove = (event: PointerEvent) => {
			if (brush !== null) brushTo(local(event, overview).x);
		};
		const onBrushUp = (event: PointerEvent) => {
			if (brush === null) return;
			brushTo(local(event, overview).x);
			brush = null;
		};
		canvas.addEventListener("wheel", onWheel, { passive: false });
		canvas.addEventListener("pointerdown", onDown);
		canvas.addEventListener("pointermove", onMove);
		canvas.addEventListener("pointerup", onUp);
		canvas.addEventListener("pointerleave", onLeave);
		canvas.addEventListener("dblclick", onDouble);
		overview.addEventListener("pointerdown", onBrushDown);
		overview.addEventListener("pointermove", onBrushMove);
		overview.addEventListener("pointerup", onBrushUp);
		return () => {
			canvas.removeEventListener("wheel", onWheel);
			canvas.removeEventListener("pointerdown", onDown);
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("pointerup", onUp);
			canvas.removeEventListener("pointerleave", onLeave);
			canvas.removeEventListener("dblclick", onDouble);
			overview.removeEventListener("pointerdown", onBrushDown);
			overview.removeEventListener("pointermove", onBrushMove);
			overview.removeEventListener("pointerup", onBrushUp);
		};
	}, [data.calls]);

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		const middle = (view.v0 + view.v1) / 2;
		const commands: Record<string, () => void> = {
			[PANEL_KEYS.zoomIn]: () => setView(zoomAt(view, count, middle, ZOOM_STEP)),
			[PANEL_KEYS.zoomOut]: () => setView(zoomAt(view, count, middle, 1 / ZOOM_STEP)),
			[PANEL_KEYS.zoomFit]: () => setView(fullView(count)),
		};
		const navigation: Record<string, () => void> = {
			ArrowRight: () => onSelect(Math.min(count - 1, (selected ?? -1) + 1)),
			ArrowLeft: () => onSelect(Math.max(0, (selected ?? count) - 1)),
			Home: () => onSelect(0),
			End: () => onSelect(count - 1),
		};
		const command = local.match(event.nativeEvent);
		const action =
			command === null ? (plainKey(event) ? navigation[event.key] : undefined) : commands[command];
		if (!action || count === 0) return;
		event.preventDefault();
		action();
	};
	const current = selected === null ? undefined : data.calls[selected];

	return (
		<div className="flex flex-col gap-4">
			<div
				ref={setRoot}
				data-testid="context-chart"
				data-calls={count}
				data-misses={data.calls.filter((call) => call.miss).length}
				className="relative h-354 has-[:focus-visible]:focus-ring-inset"
			>
				<button
					type="button"
					data-testid="context-keys"
					data-key-scope={PANEL_SCOPE}
					aria-describedby={`${sessionId}-context-keys`}
					aria-keyshortcuts={local.aria(...CHART_KEYS)}
					onKeyDown={onKeyDown}
					className="sr-only"
				>
					{t("sessionInsights.context.canvasLabel")}
				</button>
				<div aria-hidden="true" className="absolute inset-0">
					<canvas
						ref={chartRef}
						data-testid="context-canvas"
						className="absolute inset-x-0 top-0 block h-322 w-full cursor-crosshair"
					/>
					<Markers data={data} view={view} width={width} font={font} />
					<canvas
						ref={overviewRef}
						data-testid="context-overview"
						className="absolute inset-x-0 bottom-0 block h-28 w-full cursor-ew-resize rounded-sm bg-container-header-bg"
					/>
				</div>
				<span id={`${sessionId}-context-keys`} className="sr-only">
					{t("sessionInsights.context.keys", {
						zoom: keyLabels(local, PANEL_KEYS.zoomIn, PANEL_KEYS.zoomOut),
						fit: keyLabels(local, PANEL_KEYS.zoomFit),
					})}
				</span>
				<span aria-live="polite" className="sr-only">
					{current
						? t("sessionInsights.context.callTitle", { n: current.n, model: current.model ?? "—" })
						: ""}
				</span>
			</div>
		</div>
	);
}
