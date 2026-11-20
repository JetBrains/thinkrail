import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import { onThemeSwap } from "@thinkrail/ui/theme";
import { cn } from "@thinkrail/ui/utils";
import { type AriaLabelConfig, type ColorMode, useViewport, ViewportPortal } from "@xyflow/react";
import { type KeyboardEvent, type ReactNode, useSyncExternalStore } from "react";
import { DAY_MS, xOfDay } from "./roadmapGraph";

/** xyflow's zoom controls on token surfaces (base.css leaves them unstyled). */
export const FLOW_CONTROLS =
	"overflow-hidden rounded-sm border border-border-default [&_button]:border-b [&_button]:border-border-muted [&_button]:bg-container-elevated-bg [&_button]:text-text-muted [&_button:hover]:bg-control-bg-hovered [&_button:hover]:text-text-default";

/** The flow's frame: the canvas surface, and xyflow's attribution kept and restyled (xyflow asks it stays). */
export function FlowFrame({
	testId,
	label,
	children,
	onKeyDown,
	...data
}: {
	testId: string;
	label: string;
	children: ReactNode;
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
} & { [attribute: `data-${string}`]: string | number | undefined }) {
	return (
		<section
			data-testid={testId}
			aria-label={label}
			onKeyDown={onKeyDown}
			{...data}
			className="relative min-h-0 w-full min-w-0 flex-1 overflow-hidden bg-container-content-bg [&_.react-flow\_\_attribution]:rounded-tl-sm [&_.react-flow\_\_attribution]:bg-container-elevated-bg [&_.react-flow\_\_attribution_a]:text-text-subtle"
		>
			{children}
		</section>
	);
}

function appearance(): ColorMode {
	if (typeof document === "undefined") return "dark";
	return document.documentElement.dataset.themeAppearance === "light" ? "light" : "dark";
}

/** xyflow's colour mode from the app's appearance (`data-theme` holds a theme id, not a mode). */
export function useColorMode(): ColorMode {
	return useSyncExternalStore(onThemeSwap, appearance, () => "dark");
}

/** xyflow's screen-reader texts, in the app's language. */
export function ariaLabels(t: Translator): Partial<AriaLabelConfig> {
	return {
		"node.a11yDescription.default": t("board.roadmap.graph.a11y.node"),
		"node.a11yDescription.keyboardDisabled": t("board.roadmap.graph.a11y.node"),
		"node.a11yDescription.ariaLiveMessage": ({ direction }) =>
			t("board.roadmap.graph.a11y.moved", { direction }),
		"edge.a11yDescription.default": t("board.roadmap.graph.a11y.edge"),
		"controls.ariaLabel": t("board.roadmap.graph.controls"),
		"controls.zoomIn.ariaLabel": t("board.roadmap.graph.zoomIn"),
		"controls.zoomOut.ariaLabel": t("board.roadmap.graph.zoomOut"),
		"controls.fitView.ariaLabel": t("board.roadmap.graph.fit"),
		"controls.interactive.ariaLabel": t("board.roadmap.graph.interactive"),
		"minimap.ariaLabel": t("board.roadmap.graph.minimap"),
		"handle.ariaLabel": t("board.roadmap.graph.handle"),
	};
}

/** A day as a short date ("Nov 18"), in the translator's language. */
export function shortDay(t: Translator, day: number): string {
	return new Date(Math.floor(day) * DAY_MS).toLocaleDateString(localeOf(t), {
		timeZone: "UTC",
		month: "short",
		day: "numeric",
	});
}

/** Diagonal hatching for a wait or a forecast, filled with the tone's muted step. */
export function Hatch({ id, tone }: { id: string; tone: "warning" | "info" }) {
	return (
		<defs>
			<pattern
				id={id}
				width={6}
				height={6}
				patternUnits="userSpaceOnUse"
				patternTransform="rotate(45)"
			>
				<rect
					width={3}
					height={6}
					className={
						tone === "warning" ? "fill-feedback-warning-muted" : "fill-feedback-info-muted"
					}
				/>
			</pattern>
		</defs>
	);
}

export interface GridBand {
	key: string;
	top: number;
	height: number;
	label: string | null;
}

/**
 * The time scale behind the nodes, in flow coordinates: lane bands (alternately shaded, their labels
 * held at the visible left edge), a line per Monday with its date held at the visible top, and today.
 */
export function TimeGrid({
	today,
	px,
	day0,
	day1,
	weeks,
	height,
	bands,
}: {
	today: number;
	px: number;
	day0: number;
	day1: number;
	weeks: readonly number[];
	height: number;
	bands: readonly GridBand[];
}) {
	const t = useT();
	const viewport = useViewport();
	const left = xOfDay(day0, today, px);
	const right = xOfDay(day1, today, px);
	const labelX = Math.max(left, -viewport.x / viewport.zoom) + 8;
	const labelY = Math.max(0, -viewport.y / viewport.zoom) + 16;
	const now = xOfDay(today, today, px);
	return (
		<ViewportPortal>
			<svg
				aria-hidden
				data-testid="board-graph-grid"
				width={1}
				height={1}
				className="pointer-events-none absolute top-0 left-0 -z-1 overflow-visible"
			>
				{bands.map((band, index) => (
					<g key={band.key}>
						<rect
							x={left}
							y={band.top}
							width={right - left}
							height={band.height}
							className={cn(index % 2 === 1 ? "fill-sunken" : "fill-none")}
						/>
						<line
							x1={left}
							x2={right}
							y1={band.top}
							y2={band.top}
							strokeDasharray="4 4"
							className="stroke-border-muted"
						/>
						{band.label ? (
							<text x={labelX} y={band.top + 16} className="fill-text-muted tr-text-eyebrow">
								{band.label}
							</text>
						) : null}
					</g>
				))}
				{weeks.map((day) => {
					const x = xOfDay(day, today, px);
					return (
						<g key={day}>
							<line x1={x} x2={x} y1={0} y2={height} className="stroke-border-muted" />
							<text x={x + 4} y={labelY} className="fill-text-subtle tr-text-caption">
								{shortDay(t, day)}
							</text>
						</g>
					);
				})}
				<line
					data-testid="board-graph-today"
					x1={now}
					x2={now}
					y1={0}
					y2={height}
					strokeWidth={2}
					className="stroke-primary"
				/>
				<text x={now + 4} y={labelY + 14} className="fill-primary tr-text-caption">
					{t("board.roadmap.graph.today")}
				</text>
			</svg>
		</ViewportPortal>
	);
}
