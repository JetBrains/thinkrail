import {
	RiArrowGoBackLine as ArrowGoBack,
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiFolderOpenLine as FolderOpen,
	RiGitBranchLine as GitBranch,
	RiHome2Line as House,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiCheckboxCircleLine,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { Project, Workspace } from "@thinkrail/contracts";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { RunningIcon } from "../../components/RunningIcon";
import { useNow } from "../../components/useNow";
import { copyText, platformShortcutLabel } from "../../lib";
import { RemoveWorkspaceDialog } from "../../panels/RemoveWorkspaceDialog";
import {
	canRenameWorkspace,
	canSettleWorkspace,
	loadProjectWorkspaces,
	openWorkspaceIn,
	renameWorkspace,
	revealWorkspace,
	settleWorkspace,
	unsettleWorkspace,
	useEditors,
	useWorkspaceRename,
} from "../../panels/workspaceActions";
import {
	isDefaultWorkspace,
	isExternalWorkspace,
	selectWorkspaceIsRunning,
	selectWorkspaceNeedsAttention,
	selectWorkspacePartition,
	selectWorkspaceSettledReason,
	settledReasonLabel,
	useAppStore,
} from "../../store";
import { PillChevron, pillClass, Segment } from "./Segment";

export function WorkspaceSegment({
	project,
	workspace,
	onNewWorkspace,
}: {
	project: Project;
	workspace: Workspace | null;
	onNewWorkspace: () => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const siblings = useAppStore((s) => s.workspaces[project.id]);
	const sessionStateByWorkspace = useAppStore((s) => (menuOpen ? s.sessionStateByWorkspace : null));
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const now = useNow();
	const activeWorkspaceLiveLatch = useAppStore((s) => s.activeWorkspaceLiveLatch);
	const settleIdleDays = useAppStore((s) => s.settleIdleDays);
	const workspaceSort = useAppStore((s) => s.workspaceSort);
	const activeSettled = useAppStore((s) =>
		workspace
			? selectWorkspaceSettledReason(
					{
						protocolVersion: s.protocolVersion,
						sessionStateByWorkspace: s.sessionStateByWorkspace,
						activeWorkspaceId: s.activeWorkspaceId,
						activeWorkspaceLiveLatch: s.activeWorkspaceLiveLatch,
						settleIdleDays: s.settleIdleDays,
					},
					workspace,
					now,
				) !== null
			: false,
	);
	const activeBlocked = useAppStore(
		(s) =>
			workspace !== null &&
			(selectWorkspaceIsRunning(s, workspace.id) || selectWorkspaceNeedsAttention(s, workspace.id)),
	);
	const canSettle = workspace !== null && canSettleWorkspace(protocolVersion, workspace);
	const editors = useEditors();
	const [removing, setRemoving] = useState<Workspace | null>(null);
	const workspaceId = workspace?.id ?? null;
	useEffect(() => {
		setRemoving((current) => (current && current.id !== workspaceId ? null : current));
	}, [workspaceId]);

	useEffect(() => {
		if (!menuOpen || siblings !== undefined) return;
		void loadProjectWorkspaces(project.id).catch(() => {});
	}, [menuOpen, project.id, siblings]);

	const canRename = workspace !== null && canRenameWorkspace(protocolVersion, workspace);
	const isDefault = workspace !== null && isDefaultWorkspace(workspace);
	const isExternal = workspace !== null && isExternalWorkspace(workspace);
	const name = workspace?.name ?? "Project home";
	const {
		editing,
		nameRef,
		start: startRename,
		inputProps: renameInputProps,
		onMenuCloseAutoFocus,
	} = useWorkspaceRename({ workspace, canRename, onRename: renameWorkspace });

	const partition = useMemo(() => {
		if (!menuOpen || siblings === undefined) return null;
		const projection = {
			workspaces: { [project.id]: siblings },
			protocolVersion,
			sessionStateByWorkspace: sessionStateByWorkspace ?? {},
			activeWorkspaceId: workspace?.id ?? null,
			activeWorkspaceLiveLatch,
			settleIdleDays,
			workspaceSort,
		};
		const split = selectWorkspacePartition(projection, project.id, now);
		return {
			now,
			live: split.live.filter((candidate) => candidate.id !== workspace?.id),
			settled: split.settled.filter((row) => row.workspace.id !== workspace?.id),
		};
	}, [
		menuOpen,
		siblings,
		sessionStateByWorkspace,
		project.id,
		protocolVersion,
		workspace?.id,
		activeWorkspaceLiveLatch,
		settleIdleDays,
		workspaceSort,
		now,
	]);

	return (
		<Segment
			caption={
				<>
					Workspace
					{activeSettled ? (
						<span data-testid="scope-workspace-settled" className="text-feedback-warning">
							· settled
						</span>
					) : null}
				</>
			}
			testid="scope-workspace-segment"
			className="max-w-[460px] border-l-0 pr-0 pl-0 sm:border-l sm:pr-8 sm:pl-12"
		>
			{editing && workspace ? (
				<input
					ref={nameRef}
					data-testid="scope-name"
					data-editing
					type="text"
					spellCheck={false}
					aria-label="Workspace name"
					defaultValue={workspace.name}
					{...renameInputProps}
					className="window-no-drag h-20 w-full min-w-0 truncate rounded-[var(--radius-sm)] border-0 bg-control-bg px-8 text-text-default tr-title-section outline-none ring-1 ring-control-border-active"
				/>
			) : (
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger
						data-testid="scope-workspace"
						aria-label={`Workspace ${name}`}
						className={cn(pillClass, "text-text-default")}
					>
						<span data-testid="scope-name" className="truncate tr-title-section">
							{name}
						</span>
						<PillChevron className="hidden sm:block" />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						data-testid="scope-workspace-menu"
						onCloseAutoFocus={onMenuCloseAutoFocus}
					>
						{workspace ? (
							<>
								<DropdownMenuLabel className="truncate">{workspace.name}</DropdownMenuLabel>
								{editors.length > 0 ? (
									<DropdownMenuSub>
										<DropdownMenuSubTrigger data-testid="scope-workspace-open-in">
											<ExternalLink />
											Open in
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent>
											{editors.map((editor) => (
												<DropdownMenuItem
													key={editor.id}
													data-testid="scope-workspace-open-in-editor"
													onSelect={() => openWorkspaceIn(workspace, editor)}
												>
													{editor.label}
												</DropdownMenuItem>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								) : null}
								{canRename ? (
									<DropdownMenuItem data-testid="scope-workspace-rename" onSelect={startRename}>
										<Pencil />
										Rename
									</DropdownMenuItem>
								) : null}
								<DropdownMenuItem
									data-testid="scope-workspace-copy-path"
									onSelect={() => void copyText(workspace.worktreePath)}
								>
									<Copy />
									Copy path
								</DropdownMenuItem>
								<DropdownMenuItem
									data-testid="scope-workspace-reveal"
									onSelect={() => revealWorkspace(workspace)}
								>
									<FolderOpen />
									Reveal in file manager
								</DropdownMenuItem>
								{canSettle ? (
									activeSettled ? (
										<DropdownMenuItem
											data-testid="scope-workspace-keep-active"
											onSelect={() => unsettleWorkspace(workspace.id)}
										>
											<ArrowGoBack />
											Keep active
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem
											data-testid="scope-workspace-settle"
											disabled={activeBlocked}
											onSelect={() => settleWorkspace(workspace.id)}
										>
											<Check />
											Settle
										</DropdownMenuItem>
									)
								) : null}
								{isDefault ? null : (
									<DropdownMenuItem
										data-testid="scope-workspace-remove"
										className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
										onSelect={() => setRemoving(workspace)}
									>
										<Trash2 />
										{isExternal ? "Remove from ThinkRail" : "Remove workspace"}
									</DropdownMenuItem>
								)}
								<DropdownMenuSeparator />
							</>
						) : null}
						<DropdownMenuLabel>Switch to</DropdownMenuLabel>
						{partition === null ? (
							<DropdownMenuItem disabled>Loading…</DropdownMenuItem>
						) : partition.live.length === 0 && partition.settled.length === 0 ? (
							<DropdownMenuItem disabled>No other workspaces</DropdownMenuItem>
						) : (
							partition.live.map((candidate) => {
								const running =
									sessionStateByWorkspace !== null &&
									selectWorkspaceIsRunning({ sessionStateByWorkspace }, candidate.id);
								const Icon = isDefaultWorkspace(candidate)
									? House
									: isExternalWorkspace(candidate)
										? FolderOpen
										: GitBranch;
								return (
									<DropdownMenuItem
										key={candidate.id}
										data-testid="scope-workspace-option"
										onSelect={() => useAppStore.getState().activateWorkspace(candidate)}
									>
										{running ? <RunningIcon className="size-14 text-primary" /> : <Icon />}
										<span className="truncate">{candidate.name}</span>
										{candidate.branch !== candidate.name ? (
											<span className="ml-auto truncate pl-8 text-text-subtle tr-code-text-small">
												{candidate.branch}
											</span>
										) : null}
									</DropdownMenuItem>
								);
							})
						)}
						{partition !== null && partition.settled.length > 0 ? (
							<DropdownMenuSub>
								<DropdownMenuSubTrigger data-testid="scope-workspace-settled-group">
									<RiCheckboxCircleLine />
									Settled · {partition.settled.length}
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="max-h-[60vh] overflow-y-auto">
									{partition.settled.map(({ workspace: candidate, reason }) => (
										<DropdownMenuItem
											key={candidate.id}
											data-testid="scope-workspace-settled-option"
											onSelect={() => useAppStore.getState().activateWorkspace(candidate)}
										>
											{isExternalWorkspace(candidate) ? <FolderOpen /> : <GitBranch />}
											<span className="truncate">{candidate.name}</span>
											<span className="ml-auto shrink-0 pl-8 text-text-subtle tr-text-caption">
												{settledReasonLabel(reason, partition.now)}
											</span>
										</DropdownMenuItem>
									))}
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						) : null}
						<DropdownMenuSeparator />
						<DropdownMenuItem data-testid="scope-workspace-new" onSelect={onNewWorkspace}>
							<Plus />
							New workspace
							<span className="ml-auto pl-8 text-text-subtle tr-text-metadata">
								{platformShortcutLabel("N")}
							</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			{removing ? (
				<RemoveWorkspaceDialog
					workspace={removing}
					open
					onOpenChange={(open) => {
						if (!open) setRemoving(null);
					}}
				/>
			) : null}
		</Segment>
	);
}
