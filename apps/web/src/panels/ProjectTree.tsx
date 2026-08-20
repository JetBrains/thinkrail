import type { EditorInfo, Project, Workspace } from "@thinkrail/contracts";
import {
	ChevronDown,
	ChevronRight,
	Copy,
	ExternalLink,
	Folder,
	FolderOpen,
	GitBranch,
	House,
	MoreVertical,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
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
import {
	isDefaultWorkspace,
	isExternalWorkspace,
	selectActiveWorkspaceProjectId,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { ExistingWorktreeDialog } from "./ExistingWorktreeDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { useOpenProject } from "./useOpenProject";

export function ProjectTree() {
	const projects = useAppStore((s) => s.projects);
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const workspaces = useAppStore((s) => s.workspaces);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);

	const [editors, setEditors] = useState<EditorInfo[]>([]);
	useEffect(() => {
		void getTransport()
			.request("editor.list", {})
			.then(setEditors)
			.catch(() => {});
	}, []);

	const [expanded, setExpanded] = useState<Set<string>>(
		() => new Set(selectedProjectId ? [selectedProjectId] : []),
	);
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
		if (!activeProjectId) return;
		setExpanded((prev) => {
			if (prev.has(activeProjectId)) return prev;
			const next = new Set(prev);
			next.add(activeProjectId);
			return next;
		});
	}, [activeProjectId]);

	const loadWorkspaces = async (projectId: string) => {
		useAppStore
			.getState()
			.setWorkspaces(projectId, await getTransport().request("workspace.list", { projectId }));
	};

	const selectProject = async (projectId: string) => {
		useAppStore.getState().selectProject(projectId);
		setExpanded((prev) => new Set(prev).add(projectId));
		await loadWorkspaces(projectId);
	};

	const selectWorkspace = (workspace: Workspace) => {
		useAppStore.getState().activateWorkspace(workspace);
	};

	const toggleExpand = (projectId: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(projectId)) {
				next.delete(projectId);
			} else {
				next.add(projectId);
				void loadWorkspaces(projectId);
			}
			return next;
		});
	};

	const { openProject, pickAndOpen, dialogs } = useOpenProject((project) =>
		selectProject(project.id),
	);

	const onWorkspaceCreated = async (workspace: Workspace) => {
		setExpanded((prev) => new Set(prev).add(workspace.projectId));
		await loadWorkspaces(workspace.projectId);
	};

	const onExistingWorktreeOpened = async (workspace: Workspace) => {
		const rows = await getTransport().request("workspace.list", {
			projectId: workspace.projectId,
		});
		const attached = rows.find((candidate) => candidate.id === workspace.id);
		if (!attached) throw new Error("The attached worktree is missing from the workspace list");
		setExpanded((prev) => new Set(prev).add(workspace.projectId));
		const store = useAppStore.getState();
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
		<nav className="flex flex-col gap-sm">
			<header className="flex h-7 items-center justify-between pr-xs pl-sm">
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
						<Plus className="size-4" />
					</Button>
				</AddProjectMenu>
			</header>

			<ul className="flex flex-col">
				{projects.map((project) => {
					const isExpanded = expanded.has(project.id);
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
							{isExpanded && list !== undefined && (
								<ul className="flex flex-col">
									{list.map((ws) => (
										<WorkspaceRow
											key={ws.id}
											workspace={ws}
											isActive={activeWorkspaceId === ws.id}
											editors={editors}
											onSelect={() => selectWorkspace(ws)}
											onOpenIn={(editor) => openWorkspaceIn(ws, editor)}
											onCopyPath={() => void copyText(ws.worktreePath)}
											onReveal={() => revealWorkspace(ws)}
											onRemove={() => removeWorkspace(ws.id)}
										/>
									))}
								</ul>
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
			className={`group flex h-7 items-center gap-xs rounded-[var(--radius-sm)] pr-xs pl-xs transition-colors ${
				menuOpen ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered"
			}`}
		>
			<button
				type="button"
				data-testid="project-expand"
				aria-label={isExpanded ? "Collapse project" : "Expand project"}
				onClick={onToggle}
				className="flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted transition-colors hover:text-text-default focus-visible:text-text-default"
				data-expanded={isExpanded}
			>
				<Chevron className="size-4" />
			</button>
			<button
				ref={onRegisterNameButton}
				type="button"
				data-testid="project-name"
				onClick={onSelect}
				className="flex min-w-0 flex-1 items-center gap-sm text-left"
			>
				<Folder className={`size-4 shrink-0 ${isSelected ? "text-primary" : "text-text-muted"}`} />
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
			<button
				type="button"
				data-testid="add-workspace"
				aria-label="Create workspace"
				onClick={onAddWorkspace}
				className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted transition-colors hover:bg-container-elevated-bg hover:text-text-default focus-visible:bg-container-elevated-bg focus-visible:text-text-default"
			>
				<Plus className="size-4" />
			</button>
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
	editors,
	onSelect,
	onOpenIn,
	onCopyPath,
	onReveal,
	onRemove,
}: {
	workspace: Workspace;
	isActive: boolean;
	editors: EditorInfo[];
	onSelect: () => void;
	onOpenIn: (editor: EditorInfo) => void;
	onCopyPath: () => void;
	onReveal: () => void;
	onRemove: () => void;
}) {
	const isDefault = isDefaultWorkspace(workspace);
	const isExternal = isExternalWorkspace(workspace);
	const Icon = isDefault ? House : isExternal ? FolderOpen : GitBranch;
	const [menuOpen, setMenuOpen] = useState(false);
	const openMenuFromContext = (event: MouseEvent) => {
		event.preventDefault();
		setMenuOpen(true);
	};
	const [confirmOpen, setConfirmOpen] = useState(false);
	return (
		<li>
			<fieldset
				aria-label={workspace.name}
				data-testid="workspace-item"
				data-active={isActive}
				data-kind={workspace.kind ?? "worktree"}
				onContextMenu={openMenuFromContext}
				className={`group flex min-h-7 min-w-0 items-center gap-sm rounded-[var(--radius-sm)] border-0 py-xs pr-xs pl-xl transition-colors ${
					isActive || menuOpen ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered"
				}`}
			>
				<button
					type="button"
					onClick={onSelect}
					className="flex min-w-0 flex-1 items-center gap-sm text-left"
				>
					<Icon className={`size-4 shrink-0 ${isActive ? "text-primary" : "text-text-muted"}`} />
					<span className="flex min-w-0 flex-1 flex-col">
						<span
							data-testid="workspace-name"
							className={`truncate tr-text-ui leading-tight ${isActive ? "text-primary" : "text-text-muted"}`}
						>
							{workspace.name}
						</span>
						{workspace.branch !== workspace.name && (
							<span
								data-testid="workspace-branch"
								className="truncate text-text-subtle tr-text-metadata leading-tight"
							>
								{workspace.branch}
							</span>
						)}
					</span>
				</button>
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger
						data-testid="workspace-menu"
						aria-label={`Actions for ${workspace.name}`}
						className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted opacity-100 outline-none transition hover:bg-container-elevated-bg hover:text-text-default [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:opacity-100"
					>
						<MoreVertical className="size-4" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" data-testid="workspace-actions">
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
