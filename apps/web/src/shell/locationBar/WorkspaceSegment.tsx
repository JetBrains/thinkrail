import {
	RiArrowGoBackLine as ArrowGoBack,
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiFolderOpenLine as FolderOpen,
	RiGitBranchLine as GitBranch,
	RiHome2Line as House,
	RiMailOpenLine as MailOpen,
	RiMailUnreadLine as MailUnread,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiCheckboxCircleLine,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { Project, Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
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
import { useEffect, useMemo, useState } from "react";
import { RunningIcon } from "../../components/RunningIcon";
import { copyText, platformShortcutLabel } from "../../lib";
import { RemoveWorkspaceDialog } from "../../panels/RemoveWorkspaceDialog";
import {
	canRenameWorkspace,
	canSettleWorkspace,
	loadProjectWorkspaces,
	markWorkspaceRead,
	markWorkspaceUnread,
	openWorkspaceIn,
	renameWorkspace,
	revealWorkspace,
	settleWorkspace,
	unsettleWorkspace,
	useEditors,
	useInlineRename,
} from "../../panels/workspaceActions";
import {
	isDefaultWorkspace,
	isExternalWorkspace,
	selectWorkspaceIsRunning,
	selectWorkspaceNeedsAttention,
	selectWorkspacePartition,
	selectWorkspaceReadAction,
	selectWorkspaceSettledReason,
	settledReasonLabel,
	supportsWorkspaceReadState,
	useAppStore,
	workspaceName,
} from "../../store";
import { PillChevron, pillClass, Segment } from "./Segment";

export function useActiveWorkspaceSettled(workspace: Workspace | null, now: number): boolean {
	return useAppStore((s) =>
		workspace
			? selectWorkspaceSettledReason(
					{
						workspaceSettlingSupported: s.workspaceSettlingSupported,
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
}

export function WorkspaceSegment({
	project,
	workspace,
	activeSettled,
	now,
	onNewWorkspace,
}: {
	project: Project;
	workspace: Workspace | null;
	activeSettled: boolean;
	now: number;
	onNewWorkspace: () => void;
}) {
	const t = useT();
	const [menuOpen, setMenuOpen] = useState(false);
	const siblings = useAppStore((s) => s.workspaces[project.id]);
	const sessionStateByWorkspace = useAppStore((s) => (menuOpen ? s.sessionStateByWorkspace : null));
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const workspaceSettlingSupported = useAppStore((s) => s.workspaceSettlingSupported);
	const activeWorkspaceLiveLatch = useAppStore((s) => s.activeWorkspaceLiveLatch);
	const settleIdleDays = useAppStore((s) => s.settleIdleDays);
	const activeBlocked = useAppStore(
		(s) =>
			workspace !== null &&
			(selectWorkspaceIsRunning(s, workspace.id) || selectWorkspaceNeedsAttention(s, workspace.id)),
	);
	const canSettle = workspace !== null && canSettleWorkspace(protocolVersion, workspace);
	const readAction = useAppStore((s) =>
		workspace !== null && supportsWorkspaceReadState(protocolVersion)
			? selectWorkspaceReadAction(s, workspace.id)
			: null,
	);
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
	const name = workspace ? workspaceName(t, workspace) : t("shell.location.project.home");
	const {
		editing,
		nameRef,
		start: startRename,
		inputProps: renameInputProps,
		onMenuCloseAutoFocus,
	} = useInlineRename({ target: workspace, canRename, onRename: renameWorkspace });

	const partition = useMemo(() => {
		if (!menuOpen || siblings === undefined) return null;
		const projection = {
			workspaces: { [project.id]: siblings },
			workspaceSettlingSupported,
			sessionStateByWorkspace: sessionStateByWorkspace ?? {},
			activeWorkspaceId: workspace?.id ?? null,
			activeWorkspaceLiveLatch,
			settleIdleDays,
		};
		const split = selectWorkspacePartition(projection, project.id, now, "recent");
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
		workspace?.id,
		activeWorkspaceLiveLatch,
		settleIdleDays,
		workspaceSettlingSupported,
		now,
	]);

	return (
		<Segment
			caption={
				<>
					{t("shell.location.workspace.caption")}
					{activeSettled ? (
						<span data-testid="scope-workspace-settled" className="text-feedback-warning">
							{t("shell.location.workspace.settledSuffix")}
						</span>
					) : null}
				</>
			}
			testid="scope-workspace-segment"
			className="min-w-64 max-w-[460px] pl-0 sm:pl-8"
		>
			{editing && workspace ? (
				<input
					ref={nameRef}
					data-testid="scope-name"
					data-editing
					type="text"
					spellCheck={false}
					aria-label={t("shell.location.workspace.nameInput")}
					defaultValue={workspace.name}
					{...renameInputProps}
					className="window-no-drag h-topbar-value w-full min-w-0 truncate rounded-sm border-0 bg-control-bg px-8 text-text-default tr-title-section outline-none ring-1 ring-control-border-active"
				/>
			) : (
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger
						data-testid="scope-workspace"
						aria-label={t("shell.location.workspace.label", { name })}
						className={pillClass}
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
								<DropdownMenuLabel className="truncate">
									{workspaceName(t, workspace)}
								</DropdownMenuLabel>
								{editors.length > 0 ? (
									<DropdownMenuSub>
										<DropdownMenuSubTrigger data-testid="scope-workspace-open-in">
											<ExternalLink />
											{t("shell.location.workspace.openIn")}
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
										{t("common.rename")}
									</DropdownMenuItem>
								) : null}
								<DropdownMenuItem
									data-testid="scope-workspace-copy-path"
									onSelect={() => void copyText(workspace.worktreePath)}
								>
									<Copy />
									{t("shell.location.workspace.copyPath")}
								</DropdownMenuItem>
								<DropdownMenuItem
									data-testid="scope-workspace-reveal"
									onSelect={() => revealWorkspace(workspace)}
								>
									<FolderOpen />
									{t("shell.location.workspace.reveal")}
								</DropdownMenuItem>
								{readAction === "markRead" ? (
									<DropdownMenuItem
										data-testid="scope-workspace-mark-read"
										onSelect={() => markWorkspaceRead(workspace.id)}
									>
										<MailOpen />
										{t("shell.location.workspace.markRead")}
									</DropdownMenuItem>
								) : readAction === "markUnread" ? (
									<DropdownMenuItem
										data-testid="scope-workspace-mark-unread"
										onSelect={() => markWorkspaceUnread(workspace.id)}
									>
										<MailUnread />
										{t("shell.location.workspace.markUnread")}
									</DropdownMenuItem>
								) : null}
								{canSettle ? (
									activeSettled ? (
										<DropdownMenuItem
											data-testid="scope-workspace-keep-active"
											onSelect={() => unsettleWorkspace(workspace.id)}
										>
											<ArrowGoBack />
											{t("shell.location.workspace.keepActive")}
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem
											data-testid="scope-workspace-settle"
											disabled={activeBlocked}
											onSelect={() => settleWorkspace(workspace.id)}
										>
											<Check />
											{t("shell.location.workspace.settle")}
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
										{isExternal
											? t("shell.location.workspace.removeExternal")
											: t("shell.location.workspace.remove")}
									</DropdownMenuItem>
								)}
								<DropdownMenuSeparator />
							</>
						) : null}
						<DropdownMenuLabel>{t("shell.location.workspace.switchTo")}</DropdownMenuLabel>
						{partition === null ? (
							<DropdownMenuItem disabled>{t("common.loading")}</DropdownMenuItem>
						) : partition.live.length === 0 && partition.settled.length === 0 ? (
							<DropdownMenuItem disabled>{t("shell.location.workspace.noOthers")}</DropdownMenuItem>
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
										<span className="truncate">{workspaceName(t, candidate)}</span>
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
									{t("shell.location.workspace.settledGroup", { count: partition.settled.length })}
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="max-h-[60vh] overflow-y-auto">
									{partition.settled.map(({ workspace: candidate, reason }) => (
										<DropdownMenuItem
											key={candidate.id}
											data-testid="scope-workspace-settled-option"
											onSelect={() => useAppStore.getState().activateWorkspace(candidate)}
										>
											{isExternalWorkspace(candidate) ? <FolderOpen /> : <GitBranch />}
											<span className="truncate">{workspaceName(t, candidate)}</span>
											<span className="ml-auto shrink-0 pl-8 text-text-subtle tr-text-caption">
												{settledReasonLabel(t, reason, partition.now)}
											</span>
										</DropdownMenuItem>
									))}
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						) : null}
						<DropdownMenuSeparator />
						<DropdownMenuItem data-testid="scope-workspace-new" onSelect={onNewWorkspace}>
							<Plus />
							{t("shell.location.workspace.new")}
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
