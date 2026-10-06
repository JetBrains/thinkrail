import {
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiFolderOpenLine as FolderOpen,
	RiGitBranchLine as GitBranch,
	RiHome2Line as House,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
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
import { useEffect, useState } from "react";
import { RunningIcon } from "../../components/RunningIcon";
import { copyText, platformShortcutLabel } from "../../lib";
import { RemoveWorkspaceDialog } from "../../panels/RemoveWorkspaceDialog";
import {
	canRenameWorkspace,
	loadProjectWorkspaces,
	openWorkspaceIn,
	renameWorkspace,
	revealWorkspace,
	useEditors,
	useWorkspaceRename,
} from "../../panels/workspaceActions";
import {
	isDefaultWorkspace,
	isExternalWorkspace,
	selectWorkspaceIsRunning,
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
	const editors = useEditors();
	const [confirmOpen, setConfirmOpen] = useState(false);

	useEffect(() => {
		if (!menuOpen || siblings !== undefined) return;
		void loadProjectWorkspaces(project.id).catch(() => {});
	}, [menuOpen, project.id, siblings]);

	const canRename = workspace !== null && canRenameWorkspace(protocolVersion, workspace);
	const isDefault = workspace !== null && isDefaultWorkspace(workspace);
	const isExternal = workspace !== null && isExternalWorkspace(workspace);
	const name = workspace?.name ?? "Project home";
	const rename = useWorkspaceRename({ workspace, canRename, onRename: renameWorkspace });

	const switchTargets = (siblings ?? []).filter((candidate) => candidate.id !== workspace?.id);

	return (
		<Segment
			caption="Workspace"
			testid="scope-workspace-segment"
			className="max-w-[460px] border-l-0 pr-0 pl-0 sm:border-l sm:pr-8 sm:pl-12"
		>
			{rename.editing && workspace ? (
				<input
					ref={rename.nameRef}
					data-testid="scope-name"
					data-editing
					type="text"
					spellCheck={false}
					aria-label="Workspace name"
					defaultValue={workspace.name}
					{...rename.inputProps}
					className="window-no-drag h-22 w-full min-w-0 truncate rounded-[var(--radius-sm)] border-0 bg-control-bg px-8 text-text-default tr-title-section outline-none ring-1 ring-control-border-active"
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
						onCloseAutoFocus={rename.onMenuCloseAutoFocus}
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
									<DropdownMenuItem data-testid="scope-workspace-rename" onSelect={rename.start}>
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
								{isDefault ? null : (
									<DropdownMenuItem
										data-testid="scope-workspace-remove"
										className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
										onSelect={() => setConfirmOpen(true)}
									>
										<Trash2 />
										{isExternal ? "Remove from ThinkRail" : "Remove workspace"}
									</DropdownMenuItem>
								)}
								<DropdownMenuSeparator />
							</>
						) : null}
						<DropdownMenuLabel>Switch to</DropdownMenuLabel>
						{siblings === undefined ? (
							<DropdownMenuItem disabled>Loading…</DropdownMenuItem>
						) : switchTargets.length === 0 ? (
							<DropdownMenuItem disabled>No other workspaces</DropdownMenuItem>
						) : (
							switchTargets.map((candidate) => {
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
			{workspace && !isDefault ? (
				<RemoveWorkspaceDialog
					workspace={workspace}
					open={confirmOpen}
					onOpenChange={setConfirmOpen}
				/>
			) : null}
		</Segment>
	);
}
