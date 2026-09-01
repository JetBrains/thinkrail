import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiFolderOpenLine as FolderOpen,
	RiGitBranchLine as GitBranch,
	RiHome2Line as House,
	RiLoader4Line as Loader2,
	RiMore2Line as MoreVertical,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiFolderFill,
	RiFolderLine,
	RiFolderOpenFill,
	RiGitBranchFill,
	RiHome2Fill,
	RiDeleteBin6Line as Trash2,
	RiCloseLine as X,
} from "@remixicon/react";
import type { EditorInfo, Project, Workspace } from "@thinkrail/contracts";
import {
	type KeyboardEvent,
	type MouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib";
import { LoadingRegion } from "../components/Skeleton";
import {
	isDefaultWorkspace,
	isExternalWorkspace,
	selectActiveWorkspaceProjectId,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport, prewarmWorkspaceSkillLoad } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { ExistingWorktreeDialog } from "./ExistingWorktreeDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { useOpenProject } from "./useOpenProject";
import { canRenameWorkspace, workspaceRenameValue } from "./workspaceActions";

const PREWARM_WORKSPACE_LIMIT = 8;

export function ProjectTree() {
	const projects = useAppStore((s) => s.projects);
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const workspaces = useAppStore((s) => s.workspaces);
	const worktreeCreations = useAppStore((s) => s.worktreeCreationsByProject);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const protocolVersion = useAppStore((s) => s.protocolVersion);

	const [editors, setEditors] = useState<EditorInfo[]>([]);
	useEffect(() => {
		void getTransport()
			.request("editor.list", {})
			.then(setEditors)
			.catch(() => {});
	}, []);

	const expandedProjectIds = useAppStore((s) => s.expandedProjectIds);
	const [dialogProjectId, setDialogProjectId] = useState<string | null>(null);
	const [existingDialogProjectId, setExistingDialogProjectId] = useState<string | null>(null);
	const addProjectButtonRef = useRef<HTMLButtonElement>(null);
	const projectNameButtonsRef = useRef(new Map<string, HTMLButtonElement>());
	const pendingCloseFocusProjectIdRef = useRef<string | null>(null);
	const workspaceDialogReturnFocusIdRef = useRef<string | null>(null);
	const existingDialogReturnFocusIdRef = useRef<string | null>(null);

	const registerProjectNameButton = useCallback(
		(projectId: string, element: HTMLButtonElement | null) => {
			if (element) projectNameButtonsRef.current.set(projectId, element);
			else projectNameButtonsRef.current.delete(projectId);
		},
		[],
	);
	const focusProjectNameOrAdd = useCallback((projectId?: string) => {
		requestAnimationFrame(() => {
			const projectButton = projectId ? projectNameButtonsRef.current.get(projectId) : undefined;
			(projectButton ?? addProjectButtonRef.current)?.focus();
		});
	}, []);

	useEffect(() => {
		const closedProjectId = pendingCloseFocusProjectIdRef.current;
		if (!closedProjectId || projects.some((project) => project.id === closedProjectId)) return;
		pendingCloseFocusProjectIdRef.current = null;
		let fallbackProjectId = projects[0]?.id;
		if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) {
			fallbackProjectId = selectedProjectId;
		}
		focusProjectNameOrAdd(fallbackProjectId);
	}, [focusProjectNameOrAdd, projects, selectedProjectId]);

	const activeProjectId = useAppStore(selectActiveWorkspaceProjectId);
	useEffect(() => {
		if (activeProjectId) useAppStore.getState().expandProject(activeProjectId);
	}, [activeProjectId]);

	const loadWorkspaces = useCallback(async (projectId: string) => {
		const rows = await getTransport().request("workspace.list", { projectId });
		const store = useAppStore.getState();
		store.setWorkspaces(projectId, rows);
		if (store.selectedProjectId !== projectId) return;
		for (const workspace of rows.slice(0, PREWARM_WORKSPACE_LIMIT)) {
			void prewarmWorkspaceSkillLoad(workspace.id).catch(() => {});
		}
	}, []);

	const pendingListLoadsRef = useRef(new Set<string>());
	useEffect(() => {
		for (const project of projects) {
			if (!expandedProjectIds[project.id] || workspaces[project.id]) continue;
			if (pendingListLoadsRef.current.has(project.id)) continue;
			pendingListLoadsRef.current.add(project.id);
			void loadWorkspaces(project.id)
				.catch(() => {})
				.finally(() => pendingListLoadsRef.current.delete(project.id));
		}
	}, [projects, expandedProjectIds, workspaces, loadWorkspaces]);

	const selectProject = async (projectId: string) => {
		useAppStore.getState().selectProject(projectId, { reveal: true });
		await loadWorkspaces(projectId);
	};

	const selectWorkspace = (workspace: Workspace) => {
		useAppStore.getState().activateWorkspace(workspace);
	};

	const toggleExpand = (projectId: string) => {
		const store = useAppStore.getState();
		const willExpand = !store.expandedProjectIds[projectId];
		store.toggleProjectExpanded(projectId);
		if (willExpand) void loadWorkspaces(projectId);
	};

	const { openProject, pickAndOpen, dialogs } = useOpenProject((project) =>
		selectProject(project.id),
	);

	const onWorkspaceCreated = async (workspace: Workspace) => {
		useAppStore.getState().expandProject(workspace.projectId);
		await loadWorkspaces(workspace.projectId);
	};

	const onExistingWorktreeOpened = async (workspace: Workspace) => {
		const rows = await getTransport().request("workspace.list", {
			projectId: workspace.projectId,
		});
		const attached = rows.find((candidate) => candidate.id === workspace.id);
		if (!attached) throw new Error("The attached worktree is missing from the workspace list");
		const store = useAppStore.getState();
		store.expandProject(workspace.projectId);
		store.setWorkspaces(workspace.projectId, rows);
		store.activateWorkspace(attached);
	};

	const removeWorkspace = (workspaceId: string) => {
		void getTransport()
			.request("workspace.remove", { id: workspaceId })
			.catch((err) => toast.error(errorText(err, "Failed to remove workspace")));
	};

	const openWorkspaceIn = (workspace: Workspace, editor: EditorInfo) => {
		if (editor.kind === "terminal") {
			useAppStore.getState().activateWorkspace(workspace);
			useAppStore.getState().addTerminal(workspace.id, `${editor.id} .`);
			return;
		}
		void getTransport()
			.request("workspace.openIn", { id: workspace.id, editor: editor.id })
			.catch((err) => toast.error(errorText(err, `Failed to open in ${editor.label}`)));
	};

	const revealWorkspace = (workspace: Workspace) => {
		void getTransport()
			.request("workspace.reveal", { id: workspace.id })
			.catch((err) => toast.error(errorText(err, "Failed to reveal workspace")));
	};

	const renameWorkspace = (workspace: Workspace, name: string) => {
		void getTransport()
			.request("workspace.rename", { id: workspace.id, name })
			.catch((err) => toast.error(errorText(err, "Failed to rename workspace")));
	};

	const closeProject = (project: Project) => {
		pendingCloseFocusProjectIdRef.current = project.id;
		void getTransport()
			.request("project.close", { id: project.id })
			.catch((err) => {
				if (pendingCloseFocusProjectIdRef.current === project.id) {
					pendingCloseFocusProjectIdRef.current = null;
				}
				focusProjectNameOrAdd(project.id);
				toast.error(errorText(err, `Couldn't close ${project.name}`));
			});
	};

	const openWorkspaceDialog = (projectId: string, returnFocusToProject: boolean) => {
		workspaceDialogReturnFocusIdRef.current = returnFocusToProject ? projectId : null;
		setDialogProjectId(projectId);
	};

	const openExistingWorktreeDialog = (projectId: string) => {
		existingDialogReturnFocusIdRef.current = projectId;
		setExistingDialogProjectId(projectId);
	};

	return (
		<nav className="flex flex-col gap-8">
			<header className="flex h-28 items-center justify-between pr-4 pl-8">
				<span className="tr-text-eyebrow text-text-muted">Projects</span>
				<AddProjectMenu
					recentProjects={recentProjects}
					onOpen={() => void pickAndOpen()}
					onOpenRecent={(p) => void openProject(p)}
				>
					<Button
						ref={addProjectButtonRef}
						variant="ghost"
						size="icon"
						data-testid="add-project-menu"
						aria-label="Add project"
					>
						<Plus className="size-14" />
					</Button>
				</AddProjectMenu>
			</header>

			<ul className="flex flex-col">
				{projects.map((project) => {
					const isExpanded = expandedProjectIds[project.id] === true;
					const list = workspaces[project.id];
					return (
						<li key={project.id}>
							<ProjectRow
								project={project}
								isSelected={selectedProjectId === project.id}
								isExpanded={isExpanded}
								workspaceCount={(list ?? []).filter((w) => !isDefaultWorkspace(w)).length}
								onToggle={() => toggleExpand(project.id)}
								onSelect={() => void selectProject(project.id)}
								onClose={() => closeProject(project)}
								onAddWorkspace={() => openWorkspaceDialog(project.id, false)}
								onAddWorkspaceFromMenu={() => openWorkspaceDialog(project.id, true)}
								onOpenExistingWorktree={() => openExistingWorktreeDialog(project.id)}
								onRegisterNameButton={(element) => registerProjectNameButton(project.id, element)}
								onRestoreFocus={() => focusProjectNameOrAdd(project.id)}
							/>
							{isExpanded && list === undefined && (
								<LoadingRegion rows={2} className="py-4 pr-8 pl-16" />
							)}
							{isExpanded && list !== undefined && (
								<ul className="mt-4 flex flex-col gap-4 motion-safe:animate-reveal">
									{list.map((ws) => (
										<WorkspaceRow
											key={ws.id}
											workspace={ws}
											isActive={activeWorkspaceId === ws.id}
											canRename={canRenameWorkspace(protocolVersion, ws)}
											editors={editors}
											onSelect={() => selectWorkspace(ws)}
											onOpenIn={(editor) => openWorkspaceIn(ws, editor)}
											onCopyPath={() => void copyText(ws.worktreePath)}
											onReveal={() => revealWorkspace(ws)}
											onRename={(name) => renameWorkspace(ws, name)}
											onRemove={() => removeWorkspace(ws.id)}
										/>
									))}
								</ul>
							)}
							{isExpanded && (worktreeCreations[project.id] ?? 0) > 0 && (
								<div
									data-testid="worktree-creating-row"
									className="flex items-center gap-8 py-4 pr-8 pl-16 tr-text-ui text-text-muted"
								>
									<Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
									Creating worktree…
								</div>
							)}
						</li>
					);
				})}
			</ul>

			{dialogProjectId !== null ? (
				<NewWorkspaceDialog
					open
					projectId={dialogProjectId}
					onOpenChange={(o) => {
						if (o) return;
						setDialogProjectId(null);
						const returnFocusId = workspaceDialogReturnFocusIdRef.current;
						workspaceDialogReturnFocusIdRef.current = null;
						if (returnFocusId) focusProjectNameOrAdd(returnFocusId);
					}}
					onCreated={(ws) => void onWorkspaceCreated(ws)}
				/>
			) : null}

			{existingDialogProjectId !== null ? (
				<ExistingWorktreeDialog
					open
					projectId={existingDialogProjectId}
					onOpenChange={(isOpen) => {
						if (isOpen) return;
						setExistingDialogProjectId(null);
						const returnFocusId = existingDialogReturnFocusIdRef.current;
						existingDialogReturnFocusIdRef.current = null;
						if (returnFocusId) focusProjectNameOrAdd(returnFocusId);
					}}
					onOpened={onExistingWorktreeOpened}
				/>
			) : null}

			{dialogs}
		</nav>
	);
}

function ProjectRow({
	project,
	isSelected,
	isExpanded,
	workspaceCount,
	onToggle,
	onSelect,
	onClose,
	onAddWorkspace,
	onAddWorkspaceFromMenu,
	onOpenExistingWorktree,
	onRegisterNameButton,
	onRestoreFocus,
}: {
	project: Project;
	isSelected: boolean;
	isExpanded: boolean;
	workspaceCount: number;
	onToggle: () => void;
	onSelect: () => void;
	onClose: () => void;
	onAddWorkspace: () => void;
	onAddWorkspaceFromMenu: () => void;
	onOpenExistingWorktree: () => void;
	onRegisterNameButton: (element: HTMLButtonElement | null) => void;
	onRestoreFocus: () => void;
}) {
	const Chevron = isExpanded ? ChevronDown : ChevronRight;
	const Folder = isSelected ? RiFolderFill : RiFolderLine;
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const openingDialogRef = useRef(false);
	const closeConfirmedRef = useRef(false);
	const openDialogAfterMenu = (openDialog: () => void) => {
		openingDialogRef.current = true;
		setMenuOpen(false);
		requestAnimationFrame(openDialog);
	};
	const row = (
		<div
			data-testid="project-item"
			data-menu-open={menuOpen}
			className={`group flex h-28 items-center gap-4 rounded-[var(--radius-sm)] pr-4 pl-4 transition-colors ${
				menuOpen ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered"
			}`}
		>
			<button
				type="button"
				data-testid="project-expand"
				aria-label={isExpanded ? "Collapse project" : "Expand project"}
				onClick={onToggle}
				className="flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted transition-colors hover:text-text-default focus-visible:text-text-default"
				data-expanded={isExpanded}
			>
				<Chevron className="size-16" />
			</button>
			<button
				ref={onRegisterNameButton}
				type="button"
				data-testid="project-name"
				onClick={onSelect}
				className="flex min-w-0 flex-1 items-center gap-4 text-left"
			>
				<Folder className={`size-14 shrink-0 ${isSelected ? "text-primary" : "text-text-muted"}`} />
				<span
					className={`truncate tr-text-ui ${isSelected ? "text-text-default" : "text-text-muted"}`}
				>
					{project.name}
				</span>
			</button>
			{!isExpanded && workspaceCount > 0 && (
				<span
					data-testid="project-workspace-count"
					className="shrink-0 tr-text-metadata text-text-muted"
				>
					{workspaceCount}
				</span>
			)}
			<Button
				variant="ghost"
				size="icon"
				className="shrink-0"
				data-testid="add-workspace"
				aria-label="Create workspace"
				onClick={onAddWorkspace}
			>
				<Plus className="size-14" />
			</Button>
		</div>
	);
	return (
		<>
			<ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
				<ContextMenuTrigger
					asChild
					onKeyDown={(event) => {
						if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
						event.preventDefault();
						const rect = event.currentTarget.getBoundingClientRect();
						event.currentTarget.dispatchEvent(
							new MouseEvent("contextmenu", {
								bubbles: true,
								clientX: rect.left,
								clientY: rect.bottom,
							}),
						);
					}}
				>
					{row}
				</ContextMenuTrigger>
				<ContextMenuContent
					data-testid="project-actions"
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (!openingDialogRef.current) onRestoreFocus();
						openingDialogRef.current = false;
					}}
				>
					<ContextMenuItem
						data-testid="project-menu-create-workspace"
						onSelect={(event) => {
							event.preventDefault();
							openDialogAfterMenu(onAddWorkspaceFromMenu);
						}}
					>
						<Plus />
						Create workspace
					</ContextMenuItem>
					<ContextMenuItem
						data-testid="project-menu-open-existing-worktree"
						onSelect={(event) => {
							event.preventDefault();
							openDialogAfterMenu(onOpenExistingWorktree);
						}}
					>
						<FolderOpen />
						Open existing worktree…
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						data-testid="project-menu-close"
						onSelect={(event) => {
							event.preventDefault();
							openDialogAfterMenu(() => setConfirmOpen(true));
						}}
					>
						<X />
						Close project
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={`Close ${project.name}?`}
				description="Removes this project from the open projects list. Its repository, workspaces, chats, and running activity are kept. Reopen it from Add project → Recents."
				confirmLabel="Close project"
				confirmTestId="confirm-close-project"
				onConfirm={() => {
					closeConfirmedRef.current = true;
					onClose();
				}}
				onClosedAutoFocus={() => {
					if (!closeConfirmedRef.current) onRestoreFocus();
					closeConfirmedRef.current = false;
				}}
			/>
		</>
	);
}

function WorkspaceRow({
	workspace,
	isActive,
	canRename,
	editors,
	onSelect,
	onOpenIn,
	onCopyPath,
	onReveal,
	onRename,
	onRemove,
}: {
	workspace: Workspace;
	isActive: boolean;
	canRename: boolean;
	editors: EditorInfo[];
	onSelect: () => void;
	onOpenIn: (editor: EditorInfo) => void;
	onCopyPath: () => void;
	onReveal: () => void;
	onRename: (name: string) => void;
	onRemove: () => void;
}) {
	const isDefault = isDefaultWorkspace(workspace);
	const isExternal = isExternalWorkspace(workspace);
	const Icon = isActive
		? isDefault
			? RiHome2Fill
			: isExternal
				? RiFolderOpenFill
				: RiGitBranchFill
		: isDefault
			? House
			: isExternal
				? FolderOpen
				: GitBranch;
	const isTwoLine = workspace.branch !== workspace.name;
	const [menuOpen, setMenuOpen] = useState(false);
	const openMenuFromContext = (event: MouseEvent) => {
		event.preventDefault();
		setMenuOpen(true);
	};
	const [confirmOpen, setConfirmOpen] = useState(false);
	const nameRef = useRef<HTMLInputElement>(null);
	const editStartNameRef = useRef(workspace.name);
	const pendingNameRef = useRef<string | null>(null);
	const cancelNextBlurRef = useRef(false);
	const enterRenameRef = useRef(false);
	const [editing, setEditing] = useState(false);

	useEffect(() => {
		if (!editing) return;
		const frame = requestAnimationFrame(() => {
			nameRef.current?.focus();
			nameRef.current?.select();
		});
		return () => cancelAnimationFrame(frame);
	}, [editing]);

	useEffect(() => {
		const name = pendingNameRef.current;
		if (!editing || !canRename || !name) return;
		pendingNameRef.current = null;
		setEditing(false);
		onRename(name);
	}, [canRename, editing, onRename]);

	const commitRename = () => {
		if (cancelNextBlurRef.current) {
			cancelNextBlurRef.current = false;
			pendingNameRef.current = null;
			setEditing(false);
			return;
		}
		const name = workspaceRenameValue(editStartNameRef.current, nameRef.current?.value ?? "");
		if (!name) {
			pendingNameRef.current = null;
			setEditing(false);
			return;
		}
		if (!canRename) {
			pendingNameRef.current = name;
			return;
		}
		setEditing(false);
		onRename(name);
	};

	const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			nameRef.current?.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelNextBlurRef.current = true;
			nameRef.current?.blur();
		}
	};

	const identityClass = `flex min-w-0 flex-1 gap-4 text-left ${isTwoLine ? "items-start" : "items-center"}`;
	const identityIcon = (
		<Icon
			className={`${isTwoLine ? "mt-2 " : ""}size-14 shrink-0 ${isActive ? "text-primary" : "text-text-muted"}`}
		/>
	);
	const branchLabel = isTwoLine ? (
		<span
			data-testid="workspace-branch"
			className="truncate text-text-subtle tr-text-metadata leading-tight"
		>
			{workspace.branch}
		</span>
	) : null;

	return (
		<li>
			<fieldset
				aria-label={workspace.name}
				data-testid="workspace-item"
				data-active={isActive}
				data-kind={workspace.kind ?? "worktree"}
				onContextMenu={openMenuFromContext}
				className={`group flex min-h-28 min-w-0 items-center gap-8 rounded-[var(--radius-sm)] border-0 py-4 pr-4 pl-24 transition-colors ${
					isActive || menuOpen ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered"
				}`}
			>
				{editing ? (
					<div className={identityClass}>
						{identityIcon}
						<span className="flex min-w-0 flex-1 flex-col">
							<input
								ref={nameRef}
								data-testid="workspace-name"
								data-editing
								type="text"
								spellCheck={false}
								aria-label="Workspace name"
								defaultValue={workspace.name}
								onKeyDown={onNameKeyDown}
								onBlur={commitRename}
								className={`w-full min-w-0 truncate border-0 bg-transparent p-0 tr-text-ui leading-tight outline-none ${isActive ? "text-primary" : "text-text-muted"}`}
							/>
							{branchLabel}
						</span>
					</div>
				) : (
					<button type="button" onClick={onSelect} className={identityClass}>
						{identityIcon}
						<span className="flex min-w-0 flex-1 flex-col">
							<span
								data-testid="workspace-name"
								className={`truncate tr-text-ui leading-tight ${isActive ? "text-primary" : "text-text-muted"}`}
							>
								{workspace.name}
							</span>
							{branchLabel}
						</span>
					</button>
				)}
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger
						data-testid="workspace-menu"
						aria-label={`Actions for ${workspace.name}`}
						className="flex size-20 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted opacity-100 outline-none transition hover:bg-container-elevated-bg hover:text-text-default [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:opacity-100"
					>
						<MoreVertical className="size-14" />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						data-testid="workspace-actions"
						onCloseAutoFocus={(event) => {
							if (!enterRenameRef.current) return;
							enterRenameRef.current = false;
							event.preventDefault();
						}}
					>
						{editors.length > 0 && (
							<DropdownMenuSub>
								<DropdownMenuSubTrigger data-testid="workspace-open-in">
									<ExternalLink />
									Open in
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent>
									{editors.map((editor) => (
										<DropdownMenuItem
											key={editor.id}
											data-testid="workspace-open-in-editor"
											onSelect={() => onOpenIn(editor)}
										>
											{editor.label}
										</DropdownMenuItem>
									))}
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						)}
						{canRename ? (
							<DropdownMenuItem
								data-testid="workspace-rename"
								onSelect={() => {
									editStartNameRef.current = workspace.name;
									pendingNameRef.current = null;
									cancelNextBlurRef.current = false;
									enterRenameRef.current = true;
									setEditing(true);
								}}
							>
								<Pencil />
								Rename
							</DropdownMenuItem>
						) : null}
						<DropdownMenuItem data-testid="workspace-copy-path" onSelect={onCopyPath}>
							<Copy />
							Copy path
						</DropdownMenuItem>
						<DropdownMenuItem data-testid="workspace-reveal" onSelect={onReveal}>
							<FolderOpen />
							Reveal in file manager
						</DropdownMenuItem>
						{!isDefault && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									data-testid="workspace-remove"
									className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
									onSelect={(event) => {
										event.preventDefault();
										setConfirmOpen(true);
									}}
								>
									<Trash2 />
									{isExternal ? "Remove from ThinkRail" : "Remove workspace"}
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</fieldset>
			{!isDefault && (
				<ConfirmDialog
					open={confirmOpen}
					onOpenChange={setConfirmOpen}
					title={
						isExternal
							? `Remove ${workspace.name} from ThinkRail?`
							: `Remove ${workspace.name} workspace`
					}
					description={
						isExternal ? (
							<>
								Removes this workspace's ThinkRail chats and terminals. The existing checkout,
								files, and branch{" "}
								<span className="tr-text-emphasis text-text-default">{workspace.branch}</span> stay
								untouched.
							</>
						) : (
							<>
								Deletes this workspace's chats, terminals, and its worktree. The git branch{" "}
								<span className="tr-text-emphasis text-text-default">{workspace.branch}</span> is
								kept.
							</>
						)
					}
					confirmLabel={isExternal ? "Remove from ThinkRail" : "Remove"}
					destructive
					confirmTestId="confirm-remove"
					onConfirm={onRemove}
				/>
			)}
		</li>
	);
}
