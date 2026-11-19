import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiSparkling2Fill,
	RiSparkling2Line,
	RiStackFill,
	RiStackLine,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	openContextMenuFromKeyboard,
} from "@thinkrail/ui/context-menu";
import { useTreeItem } from "@thinkrail/ui/tree-item";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useRef, useState } from "react";
import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";
import { type ContainerGroup, useAppStore } from "../store";
import { renameContainer } from "./containerActions";
import { treeRowControlProps, treeRowKey, useTreeKeys } from "./treeNavigation";
import { useInlineRename } from "./workspaceActions";

const HOVER_CONTROL_CLASS =
	"shrink-0 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100";

export interface ContainerRowState {
	collapsed: boolean;
	active: boolean;
	needsAttention: boolean;
	isRunning: boolean;
	orchestratorActive: boolean;
	orchestratorNeedsAttention: boolean;
	orchestratorRunning: boolean;
}

/** A container in the Projects tree: its row, then (expanded) its orchestrator and members one level deeper. */
export function ContainerGroupRows({
	group,
	level,
	nested,
	state,
	renderMember,
}: {
	group: ContainerGroup;
	level: number;
	nested: boolean;
	state: ContainerRowState;
	renderMember: (workspace: Workspace) => ReactNode;
}) {
	const { container, members, orchestrator } = group;
	return (
		<li
			role="none"
			data-testid="container-group"
			data-container-id={container.id}
			data-focus-row={container.id}
		>
			<ContainerRow group={group} level={level} nested={nested} state={state} />
			{state.collapsed ? null : (
				<ul
					role="none"
					data-focus-list={`container:${container.id}`}
					className={cn("mt-2 flex flex-col gap-2 motion-safe:animate-reveal", nested && "pl-16")}
				>
					{orchestrator ? (
						<OrchestratorRow
							workspace={orchestrator}
							level={level + 1}
							isActive={state.orchestratorActive}
							needsAttention={state.orchestratorNeedsAttention}
							isRunning={state.orchestratorRunning}
						/>
					) : null}
					{members.map(renderMember)}
				</ul>
			)}
		</li>
	);
}

function ContainerRow({
	group,
	level,
	nested,
	state,
}: {
	group: ContainerGroup;
	level: number;
	nested: boolean;
	state: ContainerRowState;
}) {
	const t = useT();
	const treeKeys = useTreeKeys();
	const { container, members } = group;
	const [menuOpen, setMenuOpen] = useState(false);
	const openingRef = useRef(false);
	const nameRef = useRef<HTMLButtonElement>(null);
	const {
		editing,
		nameRef: inputRef,
		start: startRename,
		inputProps,
	} = useInlineRename({ target: container, canRename: true, onRename: renameContainer });
	const expanded = !state.collapsed;
	const treeItem = useTreeItem(container.id, {
		level,
		label: container.name,
		expanded,
		toggles: true,
	});
	const toggle = () => useAppStore.getState().toggleContainerCollapsed(container.id);
	const addWorkspace = () =>
		useAppStore.getState().openContainerDialog({ kind: "addWorkspace", containerId: container.id });
	const remove = () =>
		useAppStore.getState().openContainerDialog({ kind: "remove", containerId: container.id });
	const fromMenu = (action: () => void) => {
		openingRef.current = true;
		setMenuOpen(false);
		requestAnimationFrame(action);
	};
	const rollUp = state.collapsed;
	const Chevron = expanded ? ChevronDown : ChevronRight;
	const Icon = state.active ? RiStackFill : RiStackLine;
	const iconClass = cn("size-14 shrink-0", state.active ? "text-primary" : "text-text-muted");
	const icon =
		rollUp && state.isRunning ? (
			<RunningIcon className={iconClass} />
		) : (
			<Icon className={iconClass} />
		);
	const nameClass = cn(
		"truncate tr-text-ui",
		state.active ? "text-text-default" : "text-text-muted",
	);
	return (
		<ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<ContextMenuTrigger asChild onKeyDown={openContextMenuFromKeyboard}>
				<div
					data-testid="container-item"
					data-row
					data-collapsed={state.collapsed}
					data-attention={(rollUp && state.needsAttention) || undefined}
					data-running={(rollUp && state.isRunning) || undefined}
					className={cn(
						"group flex h-panel-row min-w-0 items-center gap-4 rounded-sm pr-4 transition-colors",
						nested ? "pl-8" : "pl-4",
						menuOpen ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
					)}
				>
					<button
						type="button"
						{...treeRowControlProps}
						data-testid="container-expand"
						aria-label={expanded ? t("containers.collapse") : t("containers.expand")}
						onClick={toggle}
						className="flex size-16 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:text-text-default"
					>
						<Chevron className="size-16" />
					</button>
					{editing ? (
						<div className="flex min-w-0 flex-1 items-center gap-4">
							{icon}
							<input
								ref={inputRef}
								data-testid="container-name-input"
								type="text"
								spellCheck={false}
								aria-label={t("containers.nameInput")}
								defaultValue={container.name}
								{...inputProps}
								className={cn(
									"w-full min-w-0 border-0 bg-transparent p-0 focus-visible:focus-ring",
									nameClass,
								)}
							/>
						</div>
					) : (
						<button
							ref={nameRef}
							type="button"
							{...treeItem}
							data-testid="container-name"
							data-focus-row-primary
							onClick={toggle}
							onKeyDown={(event) => {
								const key = treeRowKey(event.nativeEvent, treeKeys);
								if (key === "rename") startRename();
								else if (key === "delete") remove();
								else return;
								event.preventDefault();
							}}
							className="-mx-4 -my-2 flex min-w-0 flex-1 items-center gap-4 rounded-sm px-4 py-2 text-left focus-visible:focus-ring-inset"
						>
							{icon}
							<span className={nameClass}>{container.name}</span>
						</button>
					)}
					{rollUp && state.needsAttention ? <AttentionDot /> : null}
					<span
						data-testid="container-member-count"
						title={t("containers.memberCount", { count: members.length })}
						className="shrink-0 tr-text-metadata text-text-muted"
					>
						{members.length}
					</span>
					<IconButton
						icon={Plus}
						label={t("containers.addWorkspace")}
						variant="ghost"
						size="s"
						{...treeRowControlProps}
						data-testid="container-add-workspace"
						onClick={addWorkspace}
						className={HOVER_CONTROL_CLASS}
					/>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent
				data-testid="container-actions"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (!openingRef.current) nameRef.current?.focus();
					openingRef.current = false;
				}}
			>
				<ContextMenuItem
					data-testid="container-menu-add-workspace"
					onSelect={(event) => {
						event.preventDefault();
						fromMenu(addWorkspace);
					}}
				>
					<Plus />
					{t("containers.addWorkspace")}
				</ContextMenuItem>
				<ContextMenuItem
					data-testid="container-menu-rename"
					onSelect={() => {
						openingRef.current = true;
						startRename();
					}}
				>
					<Pencil />
					{t("common.rename")}
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					data-testid="container-menu-remove"
					className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
					onSelect={(event) => {
						event.preventDefault();
						fromMenu(remove);
					}}
				>
					<Trash2 />
					{t("containers.remove")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function OrchestratorRow({
	workspace,
	level,
	isActive,
	needsAttention,
	isRunning,
}: {
	workspace: Workspace;
	level: number;
	isActive: boolean;
	needsAttention: boolean;
	isRunning: boolean;
}) {
	const t = useT();
	const label = t("containers.orchestrator");
	const treeItem = useTreeItem(workspace.id, { level, label, selected: isActive });
	const Icon = isActive ? RiSparkling2Fill : RiSparkling2Line;
	const iconClass = cn("size-14 shrink-0", isActive ? "text-primary" : "text-text-muted");
	return (
		<li role="none">
			<div
				role="none"
				data-testid="container-orchestrator"
				data-row
				data-focus-row={workspace.id}
				data-active={isActive}
				data-attention={needsAttention || undefined}
				data-running={isRunning || undefined}
				className={cn(
					"group relative flex min-h-panel-row min-w-0 items-center gap-8 rounded-sm py-2 pr-4 pl-24 transition-colors",
					isActive ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
				)}
			>
				<button
					type="button"
					{...treeItem}
					data-focus-row-primary
					onClick={() => useAppStore.getState().activateWorkspace(workspace)}
					className="-mx-4 -my-2 flex min-w-0 flex-1 items-center gap-4 rounded-sm px-4 py-2 text-left focus-visible:focus-ring-inset"
				>
					{isRunning ? <RunningIcon className={iconClass} /> : <Icon className={iconClass} />}
					<span
						className={cn(
							"truncate tr-text-ui leading-tight",
							isActive ? "text-primary" : "text-text-muted",
						)}
					>
						{label}
					</span>
				</button>
				{needsAttention ? <AttentionDot /> : null}
			</div>
		</li>
	);
}
