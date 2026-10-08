import { useDroppable } from "@dnd-kit/core";
import {
	RiCheckFill as Check,
	RiArrowLeftSLine as ChevronLeft,
	RiMoreLine as MoreHorizontal,
	RiTerminalBoxLine as SquareTerminal,
	RiCloseLine as X,
} from "@remixicon/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { memo, type ReactNode } from "react";
import { type LayoutAttention, readLayoutSelection, tupleKey } from "../../lib";
import {
	canCreateAuxiliaryGroup,
	canPlaceLayoutTab,
	isLayoutUnavailable,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	layoutTabName,
	removeLayoutGroup,
	resizeAuxiliaryGroups,
	setAuxiliaryGroupFolded,
	setBottomAlignment,
} from "./model";
import type { LayoutBottomAlignment, LayoutBottomGroup, WorkspaceLayoutDocument } from "./types";
import type { DropTarget, SharedGroupProps, WorkbenchProps } from "./workbenchShared";
import {
	DropZone,
	GroupTabBody,
	groupDomId,
	groupPanelId,
	HIDDEN_BOTTOM_DROP_ID,
	PanelWithHandle,
	tabDomId,
	useCommittedSizes,
	useElementSize,
} from "./workbenchShared";
import { TabStrip } from "./workbenchTabs";
export const BOTTOM_ALIGNMENT_LABELS: Record<LayoutBottomAlignment, string> = {
	center: "Below center",
	"center-left": "Below center and left",
	"center-right": "Below center and right",
	full: "Full width",
};

export function BottomAlignmentMenu({
	alignment,
	onChange,
	onHide,
}: {
	alignment: LayoutBottomAlignment;
	onChange: (alignment: LayoutBottomAlignment) => void;
	onHide: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Bottom panel alignment"
				title={`Bottom panel alignment: ${BOTTOM_ALIGNMENT_LABELS[alignment]}`}
				className="flex w-32 shrink-0 items-center justify-center border-border-muted border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			>
				<MoreHorizontal className="size-16" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-224">
				<DropdownMenuRadioGroup
					value={alignment}
					onValueChange={(value) => onChange(value as LayoutBottomAlignment)}
				>
					{(Object.keys(BOTTOM_ALIGNMENT_LABELS) as LayoutBottomAlignment[]).map((value) => (
						<DropdownMenuRadioItem
							key={value}
							value={value}
							data-testid={`bottom-align-${value}`}
							className="justify-between"
						>
							<span>{BOTTOM_ALIGNMENT_LABELS[value]}</span>
							{alignment === value ? <Check className="text-primary" /> : null}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onHide}>Hide bottom panel</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function BottomCreationTargets({
	group,
	groupIndex,
	shared,
}: {
	group: LayoutBottomGroup;
	groupIndex: number;
	shared: SharedGroupProps;
}) {
	const tab =
		shared.draggingTab?.kind === "tool" || shared.draggingTab?.kind === "terminal"
			? shared.draggingTab
			: null;
	const canCreateLeft = Boolean(
		tab &&
			canCreateAuxiliaryGroup(shared.document, "bottom", tab, shared.maxBottomGroups, groupIndex),
	);
	const canCreateRight = Boolean(
		tab &&
			canCreateAuxiliaryGroup(
				shared.document,
				"bottom",
				tab,
				shared.maxBottomGroups,
				groupIndex + 1,
			),
	);
	if (!canCreateLeft && !canCreateRight) return null;
	return (
		<div className="pointer-events-none absolute inset-0 z-30">
			{canCreateLeft ? (
				<DropZone
					id={tupleKey("dnd-bottom-group", group.id, "left")}
					target={{ kind: "auxiliary-edge", region: "bottom", index: groupIndex }}
					label="Create bottom group to the left"
					className="absolute inset-y-4 left-4 right-1/2"
				/>
			) : null}
			{canCreateRight ? (
				<DropZone
					id={tupleKey("dnd-bottom-group", group.id, "right")}
					target={{ kind: "auxiliary-edge", region: "bottom", index: groupIndex + 1 }}
					label="Create bottom group to the right"
					className="absolute inset-y-4 left-1/2 right-4"
				/>
			) : null}
		</div>
	);
}

export const BottomGroupView = memo(function BottomGroupView({
	group,
	groupIndex,
	selectedId,
	showAlignmentMenu,
	onFold,
	onNewTerminal,
	onAlignmentChange,
	...shared
}: SharedGroupProps & {
	group: LayoutBottomGroup;
	groupIndex: number;
	selectedId: string | undefined;
	showAlignmentMenu: boolean;
	onFold: () => void;
	onNewTerminal: () => void;
	onAlignmentChange: (alignment: LayoutBottomAlignment) => void;
}) {
	const location: LayoutGroupLocation = { area: "bottom", groupId: group.id };
	const groupRemoval = removeLayoutGroup(shared.document, location);
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	const selectedName = selected ? layoutTabName(selected) : undefined;
	return (
		<section
			id={groupDomId(location)}
			data-testid="bottom-group"
			data-group-id={group.id}
			data-folded="false"
			tabIndex={-1}
			aria-label={selectedName ? `Bottom group: ${selectedName}` : "Empty bottom group"}
			className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-container-sidebar-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
			onFocusCapture={() => shared.onFocusGroup(location, selected?.id)}
		>
			<div className="flex h-panel-header-row shrink-0 items-stretch">
				<div className="min-w-0 flex-1">
					<TabStrip
						document={shared.document}
						readAttention={shared.readAttention}
						selectionEpochRef={shared.selectionEpochRef}
						location={location}
						tabs={group.tabs}
						selectedId={selected?.id}
						maxSideGroups={shared.maxSideGroups}
						maxBottomGroups={shared.maxBottomGroups}
						draggingTab={shared.draggingTab}
						onSelect={(tabId) => shared.onSelectTab(location, tabId)}
						onClose={shared.onClose}
						onApply={shared.onApply}
						onFocusAdjacentGroup={shared.onFocusAdjacentGroup}
						onHideSide={shared.onHideSide}
						onRevealTool={shared.onRevealTool}
						onRenameChat={shared.onRenameChat}
						canFocusAdjacentGroup={shared.canFocusAdjacentGroup}
						renderTabAdornment={shared.renderTabAdornment}
						trailing={
							showAlignmentMenu ? (
								<BottomAlignmentMenu
									alignment={shared.document.bottom.alignment}
									onChange={onAlignmentChange}
									onHide={() => shared.onHideSide("bottom")}
								/>
							) : null
						}
					/>
				</div>
				{group.tabs.length === 0 ? (
					<IconTooltip
						label={isLayoutUnavailable(groupRemoval) ? groupRemoval.reason : "Remove group"}
					>
						<button
							type="button"
							data-testid="remove-layout-group"
							aria-label="Remove group"
							disabled={isLayoutUnavailable(groupRemoval)}
							onClick={() => {
								if (!isLayoutUnavailable(groupRemoval)) shared.onApply(groupRemoval);
							}}
							className="flex w-32 shrink-0 items-center justify-center border-border-muted border-b border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text"
						>
							<X className="size-14" />
						</button>
					</IconTooltip>
				) : null}
				<button
					type="button"
					data-testid="bottom-group-fold"
					aria-label="Fold bottom group"
					aria-expanded="true"
					onClick={onFold}
					className="flex w-32 shrink-0 items-center justify-center border-border-muted border-b border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<ChevronLeft className="size-16" />
				</button>
			</div>
			<div
				id={groupPanelId(location)}
				role="tabpanel"
				aria-labelledby={selected ? tabDomId(location, selected.id) : undefined}
				className="relative min-h-0 flex-1 overflow-auto"
			>
				{selected ? (
					<GroupTabBody
						key={selected.id}
						tab={selected}
						renderTabBody={shared.renderTabBody}
						renderToolBody={shared.renderToolBody}
					/>
				) : (
					<div className="flex h-full items-center justify-center p-12">
						<button
							type="button"
							data-testid="bottom-new-terminal"
							onClick={onNewTerminal}
							className="flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
						>
							<SquareTerminal className="size-16" /> New terminal
						</button>
					</div>
				)}
				<BottomCreationTargets group={group} groupIndex={groupIndex} shared={shared} />
			</div>
		</section>
	);
});
BottomGroupView.displayName = "BottomGroupView";

export function BottomFoldedGroup({
	group,
	groupIndex,
	selectedId,
	showAlignmentMenu,
	onExpand,
	onAlignmentChange,
	shared,
}: {
	group: LayoutBottomGroup;
	groupIndex: number;
	selectedId: string | undefined;
	showAlignmentMenu: boolean;
	onExpand: () => void;
	onAlignmentChange: (alignment: LayoutBottomAlignment) => void;
	shared: SharedGroupProps;
}) {
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	const selectedName = selected ? layoutTabName(selected) : undefined;
	const location: LayoutGroupLocation = { area: "bottom", groupId: group.id };
	const restoreId = groupDomId(location);
	const panelId = groupPanelId(location);
	const dropEnabled = !!shared.draggingTab && canPlaceLayoutTab(shared.draggingTab, "bottom");
	const { setNodeRef, isOver } = useDroppable({
		id: tupleKey("dnd-bottom-folded", group.id),
		data: { target: { kind: "group", location } satisfies DropTarget },
		disabled: !dropEnabled,
	});
	return (
		<section
			ref={setNodeRef}
			data-testid="bottom-group"
			data-group-id={group.id}
			data-folded="true"
			data-drop-active={isOver || undefined}
			data-drop-hint={(dropEnabled && !isOver) || undefined}
			aria-label={
				selectedName ? `Folded bottom group: ${selectedName}` : "Folded empty bottom group"
			}
			className="relative flex h-full items-stretch overflow-hidden border-border-default border-r bg-container-sidebar-bg data-[drop-hint]:bg-primary-subtle data-[drop-active]:bg-primary-soft"
		>
			<div className="flex min-h-0 w-full flex-col">
				{showAlignmentMenu ? (
					<BottomAlignmentMenu
						alignment={shared.document.bottom.alignment}
						onChange={onAlignmentChange}
						onHide={() => shared.onHideSide("bottom")}
					/>
				) : null}
				<button
					id={restoreId}
					type="button"
					data-testid="bottom-group-restore"
					aria-label={`Expand bottom group${selectedName ? ` ${selectedName}` : ""}`}
					aria-controls={panelId}
					aria-expanded="false"
					onClick={onExpand}
					className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<span className="truncate [writing-mode:vertical-rl]">
						{selectedName ?? "Empty group"}
					</span>
				</button>
				<div id={panelId} role="tabpanel" aria-labelledby={restoreId} hidden />
			</div>
			<BottomCreationTargets group={group} groupIndex={groupIndex} shared={shared} />
		</section>
	);
}

export const BottomStack = memo(function BottomStack({
	attention,
	projectionEpoch,
	onCommit,
	onNewTerminal,
	...shared
}: SharedGroupProps & {
	attention: LayoutAttention;
	projectionEpoch: number;
	onCommit: WorkbenchProps["onCommit"];
	onNewTerminal: WorkbenchProps["onNewTerminal"];
}) {
	const [sizeRef, size] = useElementSize();
	const region = shared.document.bottom;
	const alignmentMenuGroupId =
		region.groups.find((group) => !group.folded)?.id ?? region.groups[0]?.id;
	const commitAlignment = (alignment: LayoutBottomAlignment) => {
		const next = setBottomAlignment(shared.document, alignment);
		if (next !== shared.document) onCommit(next);
	};
	const total = region.groups.reduce((sum, group) => sum + group.weight, 0) || 1;
	const current = region.groups.map((group) => (group.weight / total) * 100);
	const resize = useCommittedSizes(
		current,
		projectionEpoch,
		(sizes) => {
			const next = resizeAuxiliaryGroups(shared.document, "bottom", sizes);
			if (next !== shared.document) onCommit(next);
		},
		shared.onGestureCanceled,
	);
	const foldedCount = region.groups.filter((group) => group.folded).length;
	const expandedCount = region.groups.length - foldedCount;
	const roomForMinimums =
		size.width >=
		foldedCount * LAYOUT_LIMITS.foldedBottomWidth +
			expandedCount * LAYOUT_LIMITS.minBottomGroupWidth;
	const equalShare = 100 / Math.max(1, region.groups.length);
	const requestedFoldedPercent =
		size.width > 0 ? (LAYOUT_LIMITS.foldedBottomWidth / size.width) * 100 : 4;
	const foldedPercent = roomForMinimums
		? requestedFoldedPercent
		: Math.min(requestedFoldedPercent, equalShare);
	const expandedMinimum =
		roomForMinimums && size.width > 0
			? (LAYOUT_LIMITS.minBottomGroupWidth / size.width) * 100
			: Math.min(4, equalShare);
	const foldedSpacerPercent = Math.max(0, 100 - foldedCount * foldedPercent);
	return (
		<aside
			ref={sizeRef}
			aria-label="Bottom workbench"
			data-testid="bottom-panel"
			className="relative h-full min-h-0 min-w-0 overflow-hidden"
		>
			<ResizablePanelGroup
				key={tupleKey(
					"bottom-stack",
					String(projectionEpoch),
					...region.groups.flatMap((group) => [group.id, String(group.folded)]),
				)}
				direction="horizontal"
				onLayout={(sizes) => resize.onLayout(sizes.slice(0, region.groups.length))}
			>
				{region.groups.map((group, index) => {
					const sizePercent = group.folded ? foldedPercent : current[index];
					const fold = () => {
						const result = setAuxiliaryGroupFolded(
							shared.document,
							"bottom",
							group.id,
							!group.folded,
						);
						if (isLayoutUnavailable(result)) return;
						const selectedId = readLayoutSelection(attention, group.id);
						const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
						shared.onApply({
							...result,
							focusGroupId: group.id,
							...(group.folded && selected ? { focusTabId: selected.id } : {}),
						});
					};
					return (
						<PanelWithHandle
							key={tupleKey("bottom-group", group.id)}
							id={tupleKey("bottom-stack-panel", group.id)}
							order={index + 1}
							defaultSize={sizePercent}
							minSize={group.folded ? foldedPercent : expandedMinimum}
							maxSize={group.folded ? foldedPercent : 100}
							showHandle={index < region.groups.length - 1}
							handleDirection="horizontal"
							handleTestId="bottom-group-resize"
							handleDisabled={!roomForMinimums || expandedCount < 2}
							onDragging={resize.onDragging}
							onKeyboard={resize.onKeyboard}
							onKeyboardEnd={resize.onKeyboardEnd}
						>
							{group.folded ? (
								<BottomFoldedGroup
									group={group}
									groupIndex={index}
									selectedId={readLayoutSelection(attention, group.id)}
									showAlignmentMenu={group.id === alignmentMenuGroupId}
									onExpand={fold}
									onAlignmentChange={commitAlignment}
									shared={shared}
								/>
							) : (
								<BottomGroupView
									group={group}
									groupIndex={index}
									selectedId={readLayoutSelection(attention, group.id)}
									showAlignmentMenu={group.id === alignmentMenuGroupId}
									onFold={fold}
									onNewTerminal={() => onNewTerminal(group.id, "bottom")}
									onAlignmentChange={commitAlignment}
									{...shared}
								/>
							)}
						</PanelWithHandle>
					);
				})}
				{expandedCount === 0 && foldedSpacerPercent > 0 ? (
					<ResizablePanel
						id="bottom-folded-spacer"
						order={region.groups.length + 1}
						defaultSize={foldedSpacerPercent}
						minSize={foldedSpacerPercent}
						maxSize={foldedSpacerPercent}
					>
						<div aria-hidden="true" className="h-full" />
					</ResizablePanel>
				) : null}
			</ResizablePanelGroup>
		</aside>
	);
});
BottomStack.displayName = "BottomStack";

export function BottomAlignedRow({
	document,
	children,
}: {
	document: WorkspaceLayoutDocument;
	children: ReactNode;
}) {
	return (
		<div
			data-testid="bottom-aligned-row"
			data-alignment={document.bottom.alignment}
			className="h-full min-h-0 min-w-0"
		>
			{children}
		</div>
	);
}

export function BottomDropZone({
	targetGroupId,
	targetIndex,
}: {
	targetGroupId: string | undefined;
	targetIndex: number;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: HIDDEN_BOTTOM_DROP_ID,
		data: {
			target: targetGroupId
				? ({
						kind: "group",
						location: { area: "bottom", groupId: targetGroupId },
					} satisfies DropTarget)
				: ({ kind: "auxiliary-edge", region: "bottom", index: targetIndex } satisfies DropTarget),
		},
	});
	return (
		<div
			ref={setNodeRef}
			data-testid="bottom-drop-zone"
			aria-hidden="true"
			data-drop-label={
				targetGroupId ? "Reveal hidden bottom group" : "Create group in hidden bottom region"
			}
			data-drop-active={isOver || undefined}
			data-drop-hint={!isOver || undefined}
			className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 h-24 border-primary transition-colors data-[drop-hint]:border-t data-[drop-hint]:bg-primary-subtle data-[drop-active]:border-t-2 data-[drop-active]:bg-primary-soft"
		/>
	);
}
