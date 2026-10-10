import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { Fragment, forwardRef, type ReactNode, useRef, useState } from "react";
import {
	type AuxiliaryRailEntry,
	type AuxiliaryRailToolEntry,
	clusterAuxiliaryRail,
} from "./auxiliaryPresentation";
import { layoutTabName, toolTab } from "./model";
import { tabIcon } from "./tabIcon";
import type { LayoutAuxiliaryRegion } from "./types";

export interface AuxiliaryRailControlProps {
	tabIndex: number;
	onFocus: () => void;
}

export function railEntryFrameClass(region: LayoutAuxiliaryRegion | "center"): string {
	return cn(
		"relative flex w-32 shrink-0 items-center rounded-sm text-text-muted data-[active=true]:bg-control-bg-selected data-[active=true]:text-text-default",
		region === "bottom" ? "h-panel-header-control" : "h-32",
	);
}

export const RAIL_ENTRY_BUTTON_CLASS =
	"relative flex h-full min-w-0 flex-1 items-center justify-center rounded-sm outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

export function railTooltipSide(
	region: LayoutAuxiliaryRegion | "center",
): "left" | "right" | "top" {
	return region === "right" ? "left" : region === "bottom" ? "top" : "right";
}

export const AuxiliaryRailToolButton = forwardRef<
	HTMLButtonElement,
	{
		entry: AuxiliaryRailToolEntry;
		controls: string;
		control: AuxiliaryRailControlProps;
		onActivate: () => void;
	}
>(function AuxiliaryRailToolButton({ entry, controls, control, onActivate }, ref) {
	const { region } = entry;
	const active = entry.selected && entry.expanded;
	const tab = toolTab(entry.tool);
	const name = layoutTabName(tab);
	return (
		<div data-active={active} className={railEntryFrameClass(region)}>
			{active ? <AuxiliaryRailIndicator region={region} /> : null}
			<IconTooltip label={name} side={railTooltipSide(region)}>
				<button
					ref={ref}
					type="button"
					data-testid={`tool-rail-${entry.tool}`}
					data-rail-entry={entry.key}
					aria-label={name}
					aria-pressed={active}
					aria-controls={controls}
					{...control}
					onClick={onActivate}
					className={RAIL_ENTRY_BUTTON_CLASS}
				>
					{tabIcon(tab, active)}
				</button>
			</IconTooltip>
		</div>
	);
});

export function AuxiliaryRailIndicator({ region }: { region: LayoutAuxiliaryRegion }) {
	return (
		<span
			aria-hidden="true"
			data-testid="rail-selection-indicator"
			className={cn(
				"pointer-events-none absolute rounded-full bg-primary",
				region === "bottom" ? "bottom-0 left-8 h-2 w-16" : "top-8 h-16 w-2",
				region === "left" && "-left-4",
				region === "right" && "-right-4",
			)}
		/>
	);
}

export function AuxiliaryRail({
	region,
	entries,
	renderEntry,
	renderBoundary,
	trailing,
}: {
	region: LayoutAuxiliaryRegion;
	entries: readonly AuxiliaryRailEntry[];
	renderEntry: (entry: AuxiliaryRailEntry, control: AuxiliaryRailControlProps) => ReactNode;
	renderBoundary?: (paneIndex: number) => ReactNode;
	trailing?: ReactNode;
}) {
	const root = useRef<HTMLDivElement>(null);
	const [focused, setFocused] = useState<string | null>(null);
	const activeKey = entries.some((entry) => entry.key === focused)
		? focused
		: (entries.find((entry) => entry.selected && entry.expanded) ?? entries[0])?.key;
	const horizontal = region === "bottom";
	const clusters = clusterAuxiliaryRail(entries);
	const paneCount = clusters.filter((cluster) => cluster.groupId !== null).length;
	const boundary = (paneIndex: number): ReactNode => {
		const zone = renderBoundary?.(paneIndex);
		return zone ? (
			<div
				className={cn("relative shrink-0", horizontal ? "h-panel-header-control w-0" : "h-0 w-32")}
			>
				{zone}
			</div>
		) : null;
	};
	return (
		<div
			ref={root}
			role="toolbar"
			aria-label={`${region[0]?.toUpperCase()}${region.slice(1)} tools`}
			aria-orientation={horizontal ? "horizontal" : "vertical"}
			data-testid={region === "bottom" ? "bottom-tool-rail" : `${region}-layout-rail`}
			className={cn(
				"relative flex shrink-0 items-center gap-4 bg-container-header-bg",
				horizontal
					? "h-panel-header-row min-w-0 overflow-x-auto overflow-y-hidden border-border-muted border-t px-4"
					: "h-full w-40 flex-col overflow-x-hidden overflow-y-auto py-4",
				region === "left" && "border-border-muted border-r",
				region === "right" && "border-border-muted border-l",
			)}
			onKeyDown={(event) => {
				if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
				if (!(event.target instanceof HTMLElement) || !root.current?.contains(event.target)) return;
				const current = event.target.closest<HTMLButtonElement>("[data-rail-entry]");
				if (!current) return;
				const controls = Array.from(
					root.current.querySelectorAll<HTMLButtonElement>("[data-rail-entry]"),
				);
				const index = controls.indexOf(current);
				const nextKey = horizontal ? "ArrowRight" : "ArrowDown";
				const previousKey = horizontal ? "ArrowLeft" : "ArrowUp";
				const next =
					event.key === "Home"
						? 0
						: event.key === "End"
							? controls.length - 1
							: event.key === nextKey
								? (index + 1) % controls.length
								: event.key === previousKey
									? (index - 1 + controls.length) % controls.length
									: null;
				if (next === null) return;
				event.preventDefault();
				controls[next]?.focus();
				controls[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
			}}
		>
			{clusters.map((cluster, clusterIndex) => (
				<Fragment key={cluster.key}>
					{cluster.groupId !== null ? boundary(clusterIndex) : null}
					{clusterIndex > 0 ? (
						<hr
							aria-orientation={horizontal ? "vertical" : "horizontal"}
							data-testid="rail-separator"
							className={cn(
								"shrink-0 border-0 bg-border-muted",
								horizontal ? "mx-2 h-20 w-px" : "my-2 h-px w-20",
							)}
						/>
					) : null}
					{cluster.entries.map((entry) => (
						<div key={entry.key} className="relative flex shrink-0 items-center justify-center">
							{renderEntry(entry, {
								tabIndex: entry.key === activeKey ? 0 : -1,
								onFocus: () => setFocused(entry.key),
							})}
						</div>
					))}
					{clusterIndex === paneCount - 1 ? boundary(paneCount) : null}
				</Fragment>
			))}
			{paneCount === 0 ? boundary(0) : null}
			{trailing}
		</div>
	);
}
