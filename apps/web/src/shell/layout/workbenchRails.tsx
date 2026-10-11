import { useDroppable } from "@dnd-kit/core";
import {
	RiLayout2Line as PanelsTopLeft,
	RiTerminalBoxFill,
	RiTerminalBoxLine as SquareTerminal,
} from "@remixicon/react";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { type LayoutAttention, tupleKey } from "../../lib";
import {
	AuxiliaryRail,
	type AuxiliaryRailControlProps,
	AuxiliaryRailIndicator,
	RAIL_ENTRY_BUTTON_CLASS,
	railEntryFrameClass,
	railTooltipSide,
} from "./AuxiliaryRail";
import {
	type AuxiliaryRailEntry,
	activateAuxiliaryRailEntry,
	isUnplacedRailEntry,
	projectAuxiliaryRail,
} from "./auxiliaryPresentation";
import {
	canCreateAuxiliaryGroup,
	canJoinAuxiliaryGroup,
	canPlaceLayoutTab,
	findAuxiliaryGroup,
	isLayoutUnavailable,
	type LayoutGroupLocation,
	layoutTabName,
	moveTabToGroup,
	toolTab,
} from "./model";
import { tabIcon } from "./tabIcon";
import type { LayoutAuxiliaryRegion } from "./types";
import type { DropTarget, SharedGroupProps } from "./workbenchShared";
import { DropZone, groupPanelId, railControlId, railGroupDomId } from "./workbenchShared";
import { WorkbenchTab } from "./workbenchTabs";

export function AuxiliaryRailButton({
	entry,
	control,
	ordinal,
	shared,
	onActivate,
}: {
	entry: AuxiliaryRailEntry;
	control: AuxiliaryRailControlProps;
	ordinal: number;
	shared: SharedGroupProps;
	onActivate: () => void;
}) {
	const unplaced = isUnplacedRailEntry(entry);
	const group =
		entry.groupId && !unplaced
			? findAuxiliaryGroup(shared.document, entry.region, entry.groupId)
			: null;
	const dropEnabled =
		!!group &&
		!!shared.draggingTab &&
		canPlaceLayoutTab(shared.draggingTab, entry.region) &&
		canJoinAuxiliaryGroup(group, shared.draggingTab);
	const { setNodeRef, isOver } = useDroppable({
		id: tupleKey("dnd-rail-group", entry.key),
		data: {
			target: {
				kind: "group",
				location: { area: entry.region, groupId: entry.groupId ?? "" },
			} satisfies DropTarget,
		},
		disabled: !dropEnabled,
	});
	const active = entry.selected && entry.expanded;
	const name =
		entry.kind === "tool"
			? layoutTabName(toolTab(entry.tool))
			: entry.kind === "terminals"
				? `Terminal group ${ordinal}, ${entry.tabs.length} ${entry.tabs.length === 1 ? "session" : "sessions"}`
				: entry.region === "bottom"
					? "Terminal"
					: `Empty ${entry.region} group ${ordinal}`;
	return (
		<div data-active={active} className={railEntryFrameClass(entry.region)}>
			{active ? <AuxiliaryRailIndicator region={entry.region} /> : null}
			<IconTooltip
				label={
					entry.kind === "terminals" ? (
						<span>
							{name}
							<br />
							{entry.tabs.map((tab) => layoutTabName(tab)).join(", ")}
						</span>
					) : (
						name
					)
				}
				side={railTooltipSide(entry.region)}
			>
				<button
					ref={setNodeRef}
					type="button"
					id={railControlId(entry)}
					data-testid={
						entry.kind === "tool"
							? `tool-rail-${entry.tool}`
							: entry.kind === "terminals"
								? "terminal-rail-group"
								: "empty-rail-group"
					}
					data-rail-entry={entry.key}
					data-group-id={entry.groupId ?? undefined}
					aria-label={name}
					aria-pressed={active}
					aria-controls={
						group ? groupPanelId({ area: entry.region, groupId: group.id }) : undefined
					}
					{...control}
					onClick={onActivate}
					data-drop-label={dropEnabled ? `Join ${entry.region} group ${ordinal}` : undefined}
					data-drop-active={isOver || undefined}
					data-drop-hint={(dropEnabled && !isOver) || undefined}
					className={cn(
						RAIL_ENTRY_BUTTON_CLASS,
						"data-[drop-hint]:bg-primary-subtle data-[drop-active]:ring-2 data-[drop-active]:ring-inset data-[drop-active]:ring-primary",
						unplaced && "text-text-subtle",
					)}
				>
					{entry.kind === "tool" ? (
						tabIcon(toolTab(entry.tool), active)
					) : entry.kind === "terminals" || entry.region === "bottom" ? (
						active ? (
							<RiTerminalBoxFill className="size-14 shrink-0" />
						) : (
							<SquareTerminal className="size-14 shrink-0" />
						)
					) : (
						<PanelsTopLeft className="size-14 shrink-0" />
					)}
					{entry.kind === "terminals" && ordinal > 1 ? (
						<span
							aria-hidden="true"
							className="absolute right-0 bottom-0 rounded-sm bg-container-header-bg px-2 tr-text-metadata"
						>
							{ordinal}
						</span>
					) : null}
				</button>
			</IconTooltip>
		</div>
	);
}

export function AuxiliaryRegionRail({
	region,
	shared,
	attention,
	trailing,
}: {
	region: LayoutAuxiliaryRegion;
	shared: SharedGroupProps;
	attention: LayoutAttention;
	trailing?: ReactNode;
}) {
	const entries = projectAuxiliaryRail(shared.document, attention, region);
	const groups = shared.document[region].groups;
	const draggedAuxiliary =
		shared.draggingTab?.kind === "tool" || shared.draggingTab?.kind === "terminal"
			? shared.draggingTab
			: null;
	const activate = (entry: AuxiliaryRailEntry) => {
		shared.onUserNavigation();
		shared.selectionEpochRef.current += 1;
		const result = activateAuxiliaryRailEntry(
			shared.document,
			attention,
			entry,
			shared.maxSideGroups,
			shared.maxBottomGroups,
		);
		if (!isLayoutUnavailable(result)) shared.onApply(result);
	};
	const anchor = (entry: AuxiliaryRailEntry | undefined) =>
		entry?.kind === "tool" && entry.tab && entry.groupId
			? (groups
					.find((group) => group.id === entry.groupId)
					?.tabs.findIndex((tab) => tab.id === entry.tab?.id) ?? 0)
			: 0;
	const hiddenSideDrop =
		region !== "bottom" &&
		(!shared.document[region].visible || groups.every((group) => group.folded)) &&
		shared.draggingTab &&
		(shared.draggingTab.kind === "tool" || shared.draggingTab.kind === "terminal") &&
		canCreateAuxiliaryGroup(shared.document, region, shared.draggingTab, shared.maxSideGroups);
	const limit = region === "bottom" ? shared.maxBottomGroups : shared.maxSideGroups;
	const soleGroupIndex = draggedAuxiliary
		? groups.findIndex(
				(group) => group.tabs.length === 1 && group.tabs[0]?.id === draggedAuxiliary.id,
			)
		: -1;
	const renderBoundary = (paneIndex: number): ReactNode => {
		if (
			!draggedAuxiliary ||
			(soleGroupIndex >= 0 && (paneIndex === soleGroupIndex || paneIndex === soleGroupIndex + 1)) ||
			!canCreateAuxiliaryGroup(shared.document, region, draggedAuxiliary, limit, paneIndex)
		)
			return null;
		return (
			<DropZone
				id={tupleKey("dnd-rail-boundary", region, String(paneIndex))}
				target={{ kind: "auxiliary-edge", region, index: paneIndex }}
				label={`New ${region} pane here`}
				className={cn(
					"absolute",
					region === "bottom" ? "-left-6 top-0 h-28 w-12" : "-top-6 left-0 h-12 w-32",
				)}
			/>
		);
	};
	return (
		<>
			<AuxiliaryRail
				region={region}
				entries={entries}
				renderBoundary={renderBoundary}
				trailing={
					hiddenSideDrop ? (
						<DropZone
							id={tupleKey("dnd-hidden-side-edge", region)}
							target={{ kind: "auxiliary-edge", region, index: groups.length }}
							label={`Create ${region} group in hidden side`}
							className="relative min-h-32 w-32 flex-1"
						/>
					) : (
						trailing
					)
				}
				renderEntry={(entry, control) => {
					const group = groups.find((candidate) => candidate.id === entry.groupId);
					const peers = entries.filter(
						(candidate) =>
							candidate.groupId === entry.groupId && !(candidate.kind === "tool" && !candidate.tab),
					);
					const index = peers.indexOf(entry);
					const groupIndex = groups.findIndex((group) => group.id === entry.groupId);
					const previousIndex = index > 0 ? anchor(peers[index - 1]) : undefined;
					const afterIndex =
						index < peers.length - 1 ? anchor(peers[index + 1]) : (group?.tabs.length ?? 0);
					const nextIndex =
						index < peers.length - 1
							? (index + 2 < peers.length ? anchor(peers[index + 2]) : (group?.tabs.length ?? 0)) -
								1
							: undefined;
					const location: LayoutGroupLocation | null = group
						? { area: region, groupId: group.id }
						: null;
					return (
						<div
							id={entry.selected && location ? railGroupDomId(location) : undefined}
							data-group-id={entry.groupId ?? undefined}
							className={cn("relative flex items-center", region !== "bottom" && "flex-col")}
						>
							{entry.kind === "tool" && entry.tab && location ? (
								<WorkbenchTab
									tab={entry.tab}
									index={anchor(entry)}
									reorderIndexes={{ previous: previousIndex, next: nextIndex }}
									rail={{
										...control,
										entryKey: entry.key,
										vertical: region !== "bottom",
										beforeIndex: anchor(entry),
										afterIndex,
										onActivate: () => activate(entry),
									}}
									location={location}
									readAttention={shared.readAttention}
									selectionEpochRef={shared.selectionEpochRef}
									active={entry.selected && entry.expanded}
									preview={false}
									document={shared.document}
									maxSideGroups={shared.maxSideGroups}
									maxBottomGroups={shared.maxBottomGroups}
									register={() => {}}
									onSelect={() => shared.onRevealTool(entry.tool)}
									onClose={() => {
										if (entry.tab) shared.onClose(entry.tab);
									}}
									onApply={shared.onApply}
									onFocusAdjacentGroup={shared.onFocusAdjacentGroup}
									onHideSide={shared.onHideSide}
									onRevealTool={shared.onRevealTool}
									onRenameChat={shared.onRenameChat}
									canFocusAdjacentGroup={shared.canFocusAdjacentGroup}
									renderTabAdornment={shared.renderTabAdornment}
									draggingTab={shared.draggingTab}
									panelId={groupPanelId(location)}
									onKeyDown={(event) => {
										if (!entry.tab) return;
										if (
											event.key === "Delete" &&
											!event.altKey &&
											!event.ctrlKey &&
											!event.metaKey
										) {
											event.preventDefault();
											shared.onClose(entry.tab);
											return;
										}
										if (!event.altKey || !event.shiftKey) return;
										const target =
											event.key === (region === "bottom" ? "ArrowLeft" : "ArrowUp")
												? previousIndex
												: event.key === (region === "bottom" ? "ArrowRight" : "ArrowDown")
													? nextIndex
													: undefined;
										if (target === undefined) return;
										event.preventDefault();
										const moved = moveTabToGroup(shared.document, entry.tab, location, target);
										if (!isLayoutUnavailable(moved)) shared.onApply(moved);
									}}
								/>
							) : (
								<AuxiliaryRailButton
									entry={entry}
									control={control}
									ordinal={Math.max(1, groupIndex + 1)}
									shared={shared}
									onActivate={() => activate(entry)}
								/>
							)}
						</div>
					);
				}}
			/>
			{groups
				.filter((group) => !shared.document[region].visible || group.folded)
				.map((group) => {
					const entry = entries.find((entry) => entry.groupId === group.id && entry.selected);
					return (
						<section
							key={group.id}
							id={groupPanelId({ area: region, groupId: group.id })}
							aria-labelledby={entry ? railControlId(entry) : undefined}
							hidden
						/>
					);
				})}
		</>
	);
}
