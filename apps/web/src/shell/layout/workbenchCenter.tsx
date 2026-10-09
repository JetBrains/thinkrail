import { RiChatNewLine as MessageSquarePlus, RiCloseLine as X } from "@remixicon/react";
import {
	type ImperativePanelGroupHandle,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@thinkrail/ui/resizable";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { memo, useMemo, useRef } from "react";
import { type LayoutAttention, readLayoutSelection, tupleKey } from "../../lib";
import {
	canPlaceLayoutTab,
	collectCenterGroups,
	isLayoutUnavailable,
	LAYOUT_LIMITS,
	type LayoutGroupLocation,
	removeLayoutGroup,
	resizeCenterSplit,
} from "./model";
import type { LayoutCenterGroup, LayoutCenterNode, LayoutCenterSplit } from "./types";
import type { SharedGroupProps, WorkbenchProps } from "./workbenchShared";
import {
	CenterSplitTarget,
	GroupTabBody,
	groupDomId,
	groupPanelId,
	tabDomId,
	useCommittedSizes,
	useElementSize,
	useEnforcedLayout,
} from "./workbenchShared";
import { TabStrip } from "./workbenchTabs";

export const CenterGroupView = memo(function CenterGroupView({
	group,
	selectedId,
	onNewChat,
	renderEmptyCenter,
	renderCenterActions,
	...shared
}: SharedGroupProps & {
	group: LayoutCenterGroup;
	selectedId: string | undefined;
	onNewChat: WorkbenchProps["onNewChat"];
	renderEmptyCenter: WorkbenchProps["renderEmptyCenter"];
	renderCenterActions: WorkbenchProps["renderCenterActions"];
}) {
	const location: LayoutGroupLocation = { area: "center", groupId: group.id };
	const [sizeRef, size] = useElementSize();
	const splitGeometry = {
		horizontal: size.width >= LAYOUT_LIMITS.minCenterWidth * 2,
		vertical: size.height >= LAYOUT_LIMITS.minCenterHeight * 2,
	};
	const selected = group.tabs.find((tab) => tab.id === selectedId) ?? group.tabs[0];
	const groupRemoval = removeLayoutGroup(shared.document, location);
	const applySelect = (tabId: string, keep?: boolean) => {
		shared.onSelectTab(location, tabId, { center: true, ...(keep !== undefined ? { keep } : {}) });
	};
	return (
		<section
			ref={sizeRef}
			id={groupDomId(location)}
			data-testid="center-group"
			data-group-id={group.id}
			tabIndex={-1}
			aria-label={group.tabs.length === 0 ? "Empty center group" : "Center group"}
			className="relative flex h-full min-h-0 min-w-0 flex-col bg-container-content-bg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
			onFocusCapture={() => {
				if (selected) shared.onFocusGroup(location, selected.id);
			}}
		>
			<TabStrip
				document={shared.document}
				readAttention={shared.readAttention}
				selectionEpochRef={shared.selectionEpochRef}
				location={location}
				tabs={group.tabs}
				selectedId={selected?.id}
				previewId={group.previewTabId}
				maxSideGroups={shared.maxSideGroups}
				maxBottomGroups={shared.maxBottomGroups}
				draggingTab={shared.draggingTab}
				splitGeometry={splitGeometry}
				onSelect={applySelect}
				onClose={shared.onClose}
				onApply={shared.onApply}
				onFocusAdjacentGroup={shared.onFocusAdjacentGroup}
				onHideSide={shared.onHideSide}
				onRevealTool={shared.onRevealTool}
				onRenameChat={shared.onRenameChat}
				canFocusAdjacentGroup={shared.canFocusAdjacentGroup}
				renderTabAdornment={shared.renderTabAdornment}
				trailing={
					<>
						{renderCenterActions(group.id)}
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
									className="flex w-32 shrink-0 items-center justify-center text-text-muted hover:bg-control-bg-hovered hover:text-text-default disabled:text-control-disabled-text"
								>
									<X className="size-14" />
								</button>
							</IconTooltip>
						) : null}
						<IconTooltip label="New chat">
							<button
								type="button"
								data-testid="new-chat"
								aria-label="New chat"
								onClick={() => onNewChat(group.id)}
								className="flex w-32 shrink-0 items-center justify-center text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
							>
								<MessageSquarePlus className="size-14" />
							</button>
						</IconTooltip>
					</>
				}
			/>
			<div
				id={groupPanelId(location)}
				data-testid="editor-pane"
				role="tabpanel"
				aria-labelledby={selected ? tabDomId(location, selected.id) : undefined}
				className="relative min-h-0 flex-1 overflow-hidden"
			>
				{selected ? (
					<GroupTabBody
						key={selected.id}
						tab={selected}
						renderTabBody={shared.renderTabBody}
						renderToolBody={shared.renderToolBody}
					/>
				) : (
					renderEmptyCenter(group.id)
				)}
			</div>
			{shared.draggingTab &&
			canPlaceLayoutTab(shared.draggingTab, "center") &&
			collectCenterGroups(shared.document.center).length < LAYOUT_LIMITS.maxCenterGroups ? (
				<div className="pointer-events-none absolute inset-0 z-30">
					{splitGeometry.horizontal ? (
						<>
							<CenterSplitTarget
								groupId={group.id}
								direction="left"
								label="Split left"
								edgeClassName="inset-y-1/4 left-4 w-1/5"
								halfClassName="inset-y-0 left-0 w-1/2"
							/>
							<CenterSplitTarget
								groupId={group.id}
								direction="right"
								label="Split right"
								edgeClassName="inset-y-1/4 right-4 w-1/5"
								halfClassName="inset-y-0 right-0 w-1/2"
							/>
						</>
					) : null}
					{splitGeometry.vertical ? (
						<>
							<CenterSplitTarget
								groupId={group.id}
								direction="up"
								label="Split up"
								edgeClassName="inset-x-1/4 top-32 h-1/5"
								halfClassName="inset-x-0 top-0 h-1/2"
							/>
							<CenterSplitTarget
								groupId={group.id}
								direction="down"
								label="Split down"
								edgeClassName="inset-x-1/4 bottom-4 h-1/5"
								halfClassName="inset-x-0 bottom-0 h-1/2"
							/>
						</>
					) : null}
				</div>
			) : null}
		</section>
	);
});
CenterGroupView.displayName = "CenterGroupView";

export type CenterNodeProps = SharedGroupProps & {
	node: LayoutCenterNode;
	attention: LayoutAttention;
	projectionEpoch: number;
	onCommit: WorkbenchProps["onCommit"];
	onNewChat: WorkbenchProps["onNewChat"];
	renderEmptyCenter: WorkbenchProps["renderEmptyCenter"];
	renderCenterActions: WorkbenchProps["renderCenterActions"];
};

export const CenterNodeView = memo(function CenterNodeView({
	node,
	attention,
	projectionEpoch,
	onCommit,
	onNewChat,
	...shared
}: CenterNodeProps) {
	return node.kind === "group" ? (
		<CenterGroupView
			key={tupleKey("center-node", node.id)}
			group={node}
			selectedId={readLayoutSelection(attention, node.id)}
			onNewChat={onNewChat}
			{...shared}
		/>
	) : (
		<CenterSplitView
			key={tupleKey("center-node", node.id)}
			node={node}
			attention={attention}
			projectionEpoch={projectionEpoch}
			onCommit={onCommit}
			onNewChat={onNewChat}
			{...shared}
		/>
	);
});
CenterNodeView.displayName = "CenterNodeView";

export const CenterSplitView = memo(function CenterSplitView({
	node,
	attention,
	projectionEpoch,
	onCommit,
	onNewChat,
	...shared
}: Omit<CenterNodeProps, "node"> & { node: LayoutCenterSplit }) {
	const [sizeRef, size] = useElementSize();
	const weights = useMemo(() => node.weights.map((weight) => weight * 100), [node.weights]);
	const groupRef = useRef<ImperativePanelGroupHandle>(null);
	useEnforcedLayout(groupRef, weights, null);
	const resize = useCommittedSizes(
		weights,
		tupleKey(shared.workspaceId, String(projectionEpoch)),
		groupRef,
		(sizes) => {
			const next = resizeCenterSplit(shared.document, node.id, [sizes[0] ?? 50, sizes[1] ?? 50]);
			if (next !== shared.document) onCommit(next);
		},
		shared.onGestureCanceled,
	);
	const dimension = node.direction === "horizontal" ? size.width : size.height;
	const minimumPixels =
		node.direction === "horizontal" ? LAYOUT_LIMITS.minCenterWidth : LAYOUT_LIMITS.minCenterHeight;
	const minimumPercent = dimension >= minimumPixels * 2 ? (minimumPixels / dimension) * 100 : 4;
	return (
		<div ref={sizeRef} className="h-full min-h-0 min-w-0 overflow-hidden">
			<ResizablePanelGroup
				ref={groupRef}
				direction={node.direction}
				onLayout={resize.onLayout}
				className="min-h-0 min-w-0"
			>
				<ResizablePanel
					id={tupleKey("center-split-panel", node.id, "0")}
					order={1}
					defaultSize={weights[0]}
					minSize={minimumPercent}
				>
					<CenterNodeView
						node={node.children[0]}
						attention={attention}
						projectionEpoch={projectionEpoch}
						onCommit={onCommit}
						onNewChat={onNewChat}
						{...shared}
					/>
				</ResizablePanel>
				<ResizableHandle
					direction={node.direction}
					data-testid="center-split-resize"
					disabled={dimension < minimumPixels * 2}
					onDragging={resize.onDragging}
					onKeyDownCapture={resize.onKeyboard}
					onKeyUpCapture={resize.onKeyboardEnd}
				/>
				<ResizablePanel
					id={tupleKey("center-split-panel", node.id, "1")}
					order={2}
					defaultSize={weights[1]}
					minSize={minimumPercent}
				>
					<CenterNodeView
						node={node.children[1]}
						attention={attention}
						projectionEpoch={projectionEpoch}
						onCommit={onCommit}
						onNewChat={onNewChat}
						{...shared}
					/>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
});
CenterSplitView.displayName = "CenterSplitView";
