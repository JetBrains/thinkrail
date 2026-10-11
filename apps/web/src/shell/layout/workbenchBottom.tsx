import { useDroppable } from "@dnd-kit/core";
import {
	RiCheckFill as Check,
	RiMoreLine as MoreHorizontal,
	RiTerminalBoxLine as SquareTerminal,
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
import { type ImperativePanelGroupHandle, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import { memo, type ReactNode, useMemo, useRef } from "react";
import { type LayoutAttention, readLayoutSelection, tupleKey } from "../../lib";
import { resizeVisibleAuxiliaryGroups, visibleAuxiliaryGroups } from "./auxiliaryPresentation";
import {
	canCreateAuxiliaryGroup,
	isLayoutUnavailable,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	layoutTabName,
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
	useEnforcedLayout,
	useTopologySettled,
} from "./workbenchShared";
import { AuxiliaryGroupHeader } from "./workbenchSide";

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
	onAlignmentChange,
	...shared
}: SharedGroupProps & {
	group: LayoutBottomGroup;
	groupIndex: number;
	selectedId: string | undefined;
	showAlignmentMenu: boolean;
	onFold: () => void;
	onAlignmentChange: (alignment: LayoutBottomAlignment) => void;
}) {
	const location: LayoutGroupLocation = { area: "bottom", groupId: group.id };
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	const selectedName = selected ? layoutTabName(selected) : undefined;
	return (
		<section
			id={groupDomId(location)}
			data-testid="bottom-group"
			data-group-id={group.id}
			data-tools={group.tabs.flatMap((tab) => (tab.kind === "tool" ? [tab.tool] : [])).join(" ")}
			data-folded="false"
			tabIndex={-1}
			aria-label={selectedName ? `Bottom group: ${selectedName}` : "Empty bottom group"}
			className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-container-sidebar-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
			onFocusCapture={() => shared.onFocusGroup(location, selected?.id)}
		>
			<AuxiliaryGroupHeader
				region="bottom"
				group={group}
				selected={selected}
				shared={shared}
				onFold={onFold}
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
			<section
				id={groupPanelId(location)}
				role={selected?.kind === "terminal" ? "tabpanel" : undefined}
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
							onClick={() => shared.onNewTerminal(group.id, "bottom")}
							className="flex items-center gap-4 rounded-sm border border-border-default bg-container-elevated-bg px-12 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
						>
							<SquareTerminal className="size-16" /> New terminal
						</button>
					</div>
				)}
				<BottomCreationTargets group={group} groupIndex={groupIndex} shared={shared} />
			</section>
		</section>
	);
});
BottomGroupView.displayName = "BottomGroupView";

export const BottomStack = memo(function BottomStack({
	attention,
	projectionEpoch,
	onCommit,
	...shared
}: SharedGroupProps & {
	attention: LayoutAttention;
	projectionEpoch: number;
	onCommit: WorkbenchProps["onCommit"];
}) {
	const [sizeRef, size] = useElementSize();
	const region = shared.document.bottom;
	const alignmentMenuGroupId =
		region.groups.find((group) => !group.folded)?.id ?? region.groups[0]?.id;
	const commitAlignment = (alignment: LayoutBottomAlignment) => {
		const next = setBottomAlignment(shared.document, alignment);
		if (next !== shared.document) onCommit(next);
	};
	const visible = useMemo(
		() => visibleAuxiliaryGroups(shared.document, "bottom"),
		[shared.document],
	);
	const current = useMemo(() => visible.map(({ size }) => size), [visible]);
	const groupRef = useRef<ImperativePanelGroupHandle>(null);
	const roomForMinimums = size.width >= visible.length * LAYOUT_LIMITS.minBottomGroupWidth;
	const settled = useTopologySettled(tupleKey("bottom", ...visible.map(({ group }) => group.id)));
	const expandedMinimum = !settled
		? 0
		: roomForMinimums && size.width > 0
			? (LAYOUT_LIMITS.minBottomGroupWidth / size.width) * 100
			: Math.min(4, 100 / Math.max(1, visible.length));
	useEnforcedLayout(groupRef, current, settled);
	const resize = useCommittedSizes(
		current,
		tupleKey(shared.workspaceId, String(projectionEpoch)),
		groupRef,
		(sizes) => {
			const next = resizeVisibleAuxiliaryGroups(shared.document, "bottom", sizes);
			if (next !== shared.document) onCommit(next);
		},
		shared.onGestureCanceled,
	);
	return (
		<aside
			ref={sizeRef}
			aria-label="Bottom workbench"
			data-testid="bottom-panel"
			className="relative h-full min-h-0 min-w-0 overflow-hidden"
		>
			<ResizablePanelGroup ref={groupRef} direction="horizontal" onLayout={resize.onLayout}>
				{visible.map(({ group, documentIndex, size: sizePercent }, index) => {
					const fold = () => {
						const result = setAuxiliaryGroupFolded(
							shared.document,
							"bottom",
							group.id,
							!group.folded,
						);
						if (!isLayoutUnavailable(result)) shared.onApply({ ...result, focusGroupId: group.id });
					};
					return (
						<PanelWithHandle
							key={tupleKey("bottom-group", group.id)}
							id={tupleKey("bottom-stack-panel", group.id)}
							order={index + 1}
							defaultSize={sizePercent}
							minSize={expandedMinimum}
							showHandle={index < visible.length - 1}
							handleDirection="horizontal"
							handleTestId="bottom-group-resize"
							handleDisabled={!roomForMinimums || visible.length < 2}
							onDragging={resize.onDragging}
							onKeyboard={resize.onKeyboard}
							onKeyboardEnd={resize.onKeyboardEnd}
						>
							<BottomGroupView
								group={group}
								groupIndex={documentIndex}
								selectedId={readLayoutSelection(attention, group.id)}
								showAlignmentMenu={group.id === alignmentMenuGroupId}
								onFold={fold}
								onAlignmentChange={commitAlignment}
								{...shared}
							/>
						</PanelWithHandle>
					);
				})}
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
			className="pointer-events-auto relative z-20 h-24 min-w-32 flex-1 self-center border-primary transition-colors data-[drop-hint]:border-t data-[drop-hint]:bg-primary-subtle data-[drop-active]:border-t-2 data-[drop-active]:bg-primary-soft"
		/>
	);
}
