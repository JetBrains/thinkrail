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
import { useCallback, useEffect, useRef, useState } from "react";
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
import { isDefaultWorkspace, selectActiveWorkspaceProjectId, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { DiffStatBadge } from "./DiffStatBadge";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { useOpenProject } from "./useOpenProject";

/** Left-nav: projects → workspaces (git worktrees). Open a repo, select it, create/select workspaces. */
export function ProjectTree() {
	const projects = useAppStore((s) => s.projects);
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const workspaces = useAppStore((s) => s.workspaces);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);

	// The host's installed editors for every row's "Open in" submenu — host-wide, not per-workspace, so
	// it's fetched once here rather than once per row. An empty list (still loading, or none detected)
	// simply hides the submenu — never a dead entry for an app the host doesn't have.
	const [editors, setEditors] = useState<EditorInfo[]>([]);
	useEffect(() => {
		void getTransport()
			.request("editor.list", {})
			.then(setEditors)
			.catch(() => {});
	}, []);

	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	// The project a New-Workspace dialog is open for (null = closed). The "+" opens it instead of
	// creating a workspace directly.
	const [dialogProjectId, setDialogProjectId] = useState<string | null>(null);
	const addProjectButtonRef = useRef<HTMLButtonElement>(null);
	const projectNameButtonsRef = useRef(new Map<string, HTMLButtonElement>());
	const pendingCloseFocusProjectIdRef = useRef<string | null>(null);
	const workspaceDialogReturnFocusIdRef = useRef<string | null>(null);

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

	// Once this client's event-driven close removes its source row, move focus to the project selected by
	// the store's navigation fallback (or the newest open project for a background close), then Add project
	// when the rail is empty. Other clients receive the same snapshot without having their focus moved.
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

	// Reveal the active workspace's parent on mount or when its derived owner changes/resolves. Depending
	// only on that project id preserves a deliberate manual collapse across same-project switches and
	// workspace updates; creation expands its project explicitly in `onWorkspaceCreated` below.
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
		// Selecting a project atomically returns to its Welcome. The row is a deliberate "project home"
		// gesture; the chevron handles expand/collapse separately, so this never fires from just expanding.
		// The workspace's tabs survive in the store, so re-selecting it restores its view.
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

	// The shared open-project flow (open → offer to git-init a non-git folder → or a legible error). Its
	// adopt step selects + expands the freshly opened/initialised project; `dialogs` is rendered below.
	const { openProject, pickAndOpen, dialogs } = useOpenProject((project) =>
		selectProject(project.id),
	);

	// After the dialog creates a workspace: expand its project + reload the list (the dialog itself sets
	// the active workspace and kicks off any chat).
	const onWorkspaceCreated = async (workspace: Workspace) => {
		setExpanded((prev) => new Set(prev).add(workspace.projectId));
		await loadWorkspaces(workspace.projectId);
	};

	// Event-driven removal: just fire the request — no per-client optimism. The host tears the worktree
	// down and broadcasts `workspace.removed`, which every client (including this one) reacts to via
	// `applyWorkspaceRemoved`. A rejected request means no event will come, so surface it as an error toast
	// (the row simply stays).
	const removeWorkspace = (workspaceId: string) => {
		void getTransport()
			.request("workspace.remove", { id: workspaceId })
			.catch((err) => toast.error(errorText(err, "Failed to remove workspace")));
	};

	// GUI editors (`code`/`emacs`/a JetBrains IDE) launch host-side, detached, at the worktree. Vim is
	// `kind: "terminal"` — it has no window of its own, so instead of asking the host to spawn a TTY-less
	// process, activate the workspace and run it in its embedded terminal (`editor.id` doubles as the
	// literal shell command for a terminal-kind entry — a deliberate simplification for the one case).
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

	// Lossless and event-driven: the host marks the stable project record closed, then project.updated
	// removes it from every client's rail. A rejected request emits no event, so the row stays and we toast.
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
					// `undefined` = not fetched yet (render nothing — once fetched the list always holds at
					// least the ensured Default row, so there is no persistent "empty" state to name).
					const list = workspaces[project.id];
					return (
						<li key={project.id}>
							<ProjectRow
								project={project}
								isSelected={selectedProjectId === project.id}
								isExpanded={isExpanded}
								// Worktrees only: the always-present Default would make the badge a constant "≥1",
								// destroying its meaning ("you have N workspaces here").
								workspaceCount={(list ?? []).filter((w) => !isDefaultWorkspace(w)).length}
								onToggle={() => toggleExpand(project.id)}
								onSelect={() => void selectProject(project.id)}
								onClose={() => closeProject(project)}
								onAddWorkspace={() => openWorkspaceDialog(project.id, false)}
								onAddWorkspaceFromMenu={() => openWorkspaceDialog(project.id, true)}
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
	onRegisterNameButton: (element: HTMLButtonElement | null) => void;
	onRestoreFocus: () => void;
}) {
	const Chevron = isExpanded ? ChevronDown : ChevronRight;
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const openingDialogRef = useRef(false);
	const closeConfirmedRef = useRef(false);
	// Release the context menu's modal layer before mounting another one. Overlapping Radix modals can
	// otherwise race while restoring body pointer events after the next dialog closes.
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
				menuOpen ? "bg-control-bg-hovered" : "hover:bg-control-bg-hovered"
			}`}
		>
			<button
				type="button"
				data-testid="project-expand"
				aria-label={isExpanded ? "Collapse project" : "Expand project"}
				onClick={onToggle}
				className="flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-subtle transition-colors hover:text-text-default focus-visible:text-text-default"
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
					className="shrink-0 tr-text-metadata text-text-subtle"
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
	const stats = workspace.diffStats;
	// The built-in Default workspace (the project folder itself) is non-removable — the server enforces
	// it; the UI simply offers nothing (no Remove item, no confirm dialog). It wears a House icon in place
	// of the branch glyph, but otherwise gets the same "Open in" / Copy path / Reveal menu as any worktree.
	const isDefault = isDefaultWorkspace(workspace);
	const Icon = isDefault ? House : GitBranch;
	const [menuOpen, setMenuOpen] = useState(false);
	// A centered dialog, not an anchored popover: the trigger is a generic overflow icon, not a dedicated
	// delete affordance, so anchoring a confirm box to it the way the old dedicated Remove button did would
	// read oddly. Opened from the menu item's `onSelect`, `preventDefault`ed so Radix's own close-then-
	// return-focus-to-trigger doesn't fight the dialog's focus trap opening right behind it.
	const [confirmOpen, setConfirmOpen] = useState(false);
	return (
		<>
			<div
				data-testid="workspace-item"
				data-active={isActive}
				data-kind={workspace.kind ?? "worktree"}
				className={`group flex min-h-7 items-center gap-sm rounded-[var(--radius-sm)] py-xs pr-xs pl-xl transition-colors ${
					isActive || menuOpen ? "bg-control-bg-hovered" : "hover:bg-control-bg-hovered"
				}`}
			>
				<button
					type="button"
					onClick={onSelect}
					className="flex min-w-0 flex-1 items-center gap-sm text-left"
				>
					<Icon className={`size-4 shrink-0 ${isActive ? "text-primary" : "text-text-subtle"}`} />
					{/* Name on top, the git branch on a second line beneath it — the display name is decoupled
					    from the branch, so surface both without crowding one line. The branch line is hidden when
					    they coincide, so pristine/legacy rows stay a single compact line. */}
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
				<DiffStatBadge
					added={stats?.added ?? 0}
					removed={stats?.removed ?? 0}
					className="group-hover:hidden"
				/>
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger
						data-testid="workspace-menu"
						aria-label={`Actions for ${workspace.name}`}
						// This menu is the row's only surface for Open in / Copy path / Reveal / Remove, so it
						// can't be hover-only-invisible: a touch device has no hover and would never discover
						// it. `opacity-0` only applies under `(hover: hover)` (a device that actually has a
						// hover state to reveal it on) — everywhere else (touch) it stays visible by default.
						className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted opacity-100 outline-none transition hover:bg-container-elevated-bg hover:text-text-default [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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
									Remove workspace
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{!isDefault && (
				<ConfirmDialog
					open={confirmOpen}
					onOpenChange={setConfirmOpen}
					title={`Remove ${workspace.name} workspace`}
					description={
						<>
							Deletes this workspace's chats, terminals, and its worktree. The git branch{" "}
							<span className="tr-text-emphasis text-text-default">{workspace.branch}</span> is
							kept.
						</>
					}
					confirmLabel="Remove"
					destructive
					confirmTestId="confirm-remove"
					onConfirm={onRemove}
				/>
			)}
		</>
	);
}
