import {
	RiArrowGoBackLine as ArrowGoBack,
	RiCheckLine as Check,
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
	RiCheckboxCircleLine,
	RiExpandUpDownLine,
	RiFolderFill,
	RiFolderLine,
	RiFolderOpenFill,
	RiGitBranchFill,
	RiHome2Fill,
	RiDeleteBin6Line as Trash2,
	RiCloseLine as X,
} from "@remixicon/react";
import type { EditorInfo, Project, Workspace } from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";
import { copyText, platformShortcutLabel } from "@/lib";
import { LoadingRegion } from "../components/Skeleton";
import { useNow } from "../components/useNow";
import {
	isDefaultWorkspace,
	isExternalWorkspace,
	SETTLED_SHELF_MORE,
	SETTLED_SHELF_PAGE,
	type SettledReason,
	selectActiveWorkspaceProjectId,
	selectProjectIsRunning,
	selectProjectNeedsAttention,
	selectWorkspaceIsRunning,
	selectWorkspaceNeedsAttention,
	selectWorkspacePartition,
	settledReasonLabel,
	settledReasonTitle,
	toast,
	useAppStore,
	type WorkspaceSort,
} from "../store";
import { errorText, getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { ExistingWorktreeDialog } from "./ExistingWorktreeDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { RemoveWorkspaceDialog } from "./RemoveWorkspaceDialog";
import { useOpenProject } from "./useOpenProject";
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
} from "./workspaceActions";

const CREATE_WORKSPACE_LABEL = `Create workspace (${platformShortcutLabel("N")} or ${platformShortcutLabel("N", { alt: true })})`;
const SORT_LABELS: Record<WorkspaceSort, string> = {
	recent: "Recent activity",
	created: "Created",
	name: "Name",
};
const HOVER_CONTROL_CLASS =
	"flex size-20 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted opacity-100 outline-none transition hover:bg-container-elevated-bg hover:text-text-default [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:opacity-100 disabled:pointer-events-none disabled:opacity-0";

export function ProjectTree() {
	const projects = useAppStore((s) => s.projects);
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const workspaces = useAppStore((s) => s.workspaces);
	const worktreeCreations = useAppStore((s) => s.worktreeCreationsByProject);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspaceLiveLatch = useAppStore((s) => s.activeWorkspaceLiveLatch);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const supportsSettling = useAppStore((s) => s.workspaceSettlingSupported);
	const sessionStateByWorkspace = useAppStore((s) => s.sessionStateByWorkspace);
	const settleIdleDays = useAppStore((s) => s.settleIdleDays);
	const workspaceSort = useAppStore((s) => s.workspaceSort);
	const settledShelfExpanded = useAppStore((s) => s.settledShelfExpanded);
	const settledShelfShown = useAppStore((s) => s.settledShelfShown);
	const now = useNow();

	const editors = useEditors();

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

	const partitionState = {
		workspaces,
		workspaceSettlingSupported: supportsSettling,
		sessionStateByWorkspace,
		activeWorkspaceId,
		activeWorkspaceLiveLatch,
		settleIdleDays,
		workspaceSort,
	};
	const activeSettledIndex =
		activeProjectId && activeWorkspaceId
			? selectWorkspacePartition(partitionState, activeProjectId, now).settled.findIndex(
					(row) => row.workspace.id === activeWorkspaceId,
				)
			: -1;
	useEffect(() => {
		if (!activeProjectId || activeSettledIndex < 0) return;
		const store = useAppStore.getState();
		store.toggleSettledShelf(activeProjectId, true);
		store.showMoreSettled(activeProjectId, activeSettledIndex + 1);
	}, [activeProjectId, activeSettledIndex]);

	const loadWorkspaces = useCallback(async (projectId: string) => {
		await loadProjectWorkspaces(projectId);
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

	const { openProject, pickAndOpen, enterHostPath, dialogs } = useOpenProject((project) =>
		selectProject(project.id),
	);

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
		<nav data-testid="project-tree" className="flex flex-col gap-8">
			<header className="flex h-28 items-center justify-between pr-4 pl-8">
				<span className="tr-text-eyebrow text-text-muted">Projects</span>
				<AddProjectMenu
					recentProjects={recentProjects}
					onOpen={() => void pickAndOpen()}
					onEnterHostPath={enterHostPath}
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
					const stateProjection = { sessionStateByWorkspace };
					return (
						<li key={project.id}>
							<ProjectRow
								project={project}
								isSelected={selectedProjectId === project.id}
								isExpanded={isExpanded}
								needsAttention={
									!isExpanded && selectProjectNeedsAttention(stateProjection, project.id)
								}
								isRunning={!isExpanded && selectProjectIsRunning(stateProjection, project.id)}
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
								<SettledPartition
									enabled={supportsSettling}
									projectId={project.id}
									partition={selectWorkspacePartition(partitionState, project.id, now)}
									sort={workspaceSort}
									shelfExpanded={settledShelfExpanded[project.id] === true}
									shelfShown={settledShelfShown[project.id] ?? SETTLED_SHELF_PAGE}
									renderRow={(ws, settled) => (
										<WorkspaceRow
											key={ws.id}
											workspace={ws}
											settled={settled}
											now={now}
											isActive={activeWorkspaceId === ws.id}
											needsAttention={selectWorkspaceNeedsAttention(stateProjection, ws.id)}
											isRunning={selectWorkspaceIsRunning(stateProjection, ws.id)}
											canRename={canRenameWorkspace(protocolVersion, ws)}
											canSettle={canSettleWorkspace(protocolVersion, ws)}
											editors={editors}
											onSelect={() => selectWorkspace(ws)}
											onOpenIn={(editor) => openWorkspaceIn(ws, editor)}
											onCopyPath={() => void copyText(ws.worktreePath)}
											onReveal={() => revealWorkspace(ws)}
											onRename={(name) => renameWorkspace(ws, name)}
											onSettle={() => settleWorkspace(ws.id)}
											onKeepActive={() => unsettleWorkspace(ws.id)}
										/>
									)}
								/>
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

function SettledPartition({
	enabled,
	projectId,
	partition,
	sort,
	shelfExpanded,
	shelfShown,
	renderRow,
}: {
	enabled: boolean;
	projectId: string;
	partition: ReturnType<typeof selectWorkspacePartition>;
	sort: WorkspaceSort;
	shelfExpanded: boolean;
	shelfShown: number;
	renderRow: (workspace: Workspace, settled: SettledReason | null) => ReactNode;
}) {
	if (!enabled) {
		return (
			<ul className="mt-4 flex flex-col gap-4 motion-safe:animate-reveal">
				{partition.live.map((workspace) => renderRow(workspace, null))}
			</ul>
		);
	}
	const settledCount = partition.settled.length;
	const shown = partition.settled.slice(0, shelfShown);
	const remaining = settledCount - shown.length;
	return (
		<div className="mt-4 flex flex-col gap-4 motion-safe:animate-reveal">
			<label
				data-testid="workspace-sort"
				className="flex h-20 items-center gap-4 pr-4 pl-24 text-text-subtle tr-text-metadata"
			>
				<RiExpandUpDownLine className="size-12 shrink-0" aria-hidden="true" />
				<select
					aria-label="Sort workspaces"
					value={sort}
					onChange={(event) =>
						useAppStore.getState().setWorkspaceSort(event.target.value as WorkspaceSort)
					}
					className="min-w-0 cursor-pointer appearance-none truncate border-0 bg-transparent p-0 text-text-subtle tr-text-metadata outline-none hover:text-text-muted focus-visible:text-text-default"
				>
					{(Object.keys(SORT_LABELS) as WorkspaceSort[]).map((option) => (
						<option key={option} value={option}>
							{SORT_LABELS[option]}
						</option>
					))}
				</select>
			</label>
			<ul className="flex flex-col gap-4">{partition.live.map((ws) => renderRow(ws, null))}</ul>
			<div
				data-testid="settled-shelf"
				data-count={settledCount}
				data-expanded={shelfExpanded}
				className="flex h-28 min-w-0 items-center gap-4 rounded-[var(--radius-sm)] pr-4 pl-12 text-text-subtle tr-text-metadata hover:bg-control-bg-hovered"
			>
				<button
					type="button"
					data-testid="settled-shelf-toggle"
					aria-expanded={shelfExpanded}
					onClick={() => useAppStore.getState().toggleSettledShelf(projectId)}
					className="flex min-w-0 flex-1 items-center gap-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					{shelfExpanded ? (
						<ChevronDown className="size-14 shrink-0" />
					) : (
						<ChevronRight className="size-14 shrink-0" />
					)}
					<RiCheckboxCircleLine className="size-14 shrink-0" />
					<span className="truncate">Settled · {settledCount}</span>
				</button>
			</div>
			{shelfExpanded ? (
				<ul className="flex flex-col gap-2" data-testid="settled-shelf-rows">
					{settledCount === 0 ? (
						<li className="py-4 pr-4 pl-24 text-text-subtle tr-text-metadata">Nothing settled</li>
					) : (
						shown.map((row) => renderRow(row.workspace, row.reason))
					)}
					{remaining > 0 ? (
						<li>
							<button
								type="button"
								data-testid="settled-shelf-more"
								onClick={() =>
									useAppStore.getState().showMoreSettled(projectId, shelfShown + SETTLED_SHELF_MORE)
								}
								className="flex h-24 w-full items-center rounded-[var(--radius-sm)] pl-24 text-left text-text-subtle tr-text-metadata hover:bg-control-bg-hovered hover:text-text-muted"
							>
								Show {Math.min(SETTLED_SHELF_MORE, remaining)} more
							</button>
						</li>
					) : null}
				</ul>
			) : null}
		</div>
	);
}

function ProjectRow({
	project,
	isSelected,
	isExpanded,
	needsAttention,
	isRunning,
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
	needsAttention: boolean;
	isRunning: boolean;
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
			data-attention={needsAttention || undefined}
			data-running={isRunning || undefined}
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
				{isRunning ? (
					<RunningIcon className={`size-14 ${isSelected ? "text-primary" : "text-text-muted"}`} />
				) : (
					<Folder
						className={`size-14 shrink-0 ${isSelected ? "text-primary" : "text-text-muted"}`}
					/>
				)}
				<span
					className={`truncate tr-text-ui ${isSelected ? "text-text-default" : "text-text-muted"}`}
				>
					{project.name}
				</span>
			</button>
			{needsAttention ? <AttentionDot /> : null}
			{!isExpanded && workspaceCount > 0 && (
				<span
					data-testid="project-workspace-count"
					className="shrink-0 tr-text-metadata text-text-muted"
				>
					{workspaceCount}
				</span>
			)}
			<IconTooltip label={CREATE_WORKSPACE_LABEL}>
				<Button
					variant="ghost"
					size="icon"
					className="shrink-0"
					data-testid="add-workspace"
					aria-label={CREATE_WORKSPACE_LABEL}
					onClick={onAddWorkspace}
				>
					<Plus className="size-14" />
				</Button>
			</IconTooltip>
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
	settled,
	now,
	isActive,
	needsAttention,
	isRunning,
	canRename,
	canSettle,
	editors,
	onSelect,
	onOpenIn,
	onCopyPath,
	onReveal,
	onRename,
	onSettle,
	onKeepActive,
}: {
	workspace: Workspace;
	settled: SettledReason | null;
	now: number;
	isActive: boolean;
	needsAttention: boolean;
	isRunning: boolean;
	canRename: boolean;
	canSettle: boolean;
	editors: EditorInfo[];
	onSelect: () => void;
	onOpenIn: (editor: EditorInfo) => void;
	onCopyPath: () => void;
	onReveal: () => void;
	onRename: (name: string) => void;
	onSettle: () => void;
	onKeepActive: () => void;
}) {
	const isDefault = isDefaultWorkspace(workspace);
	const isExternal = isExternalWorkspace(workspace);
	const isSettled = settled !== null;
	const settleBlocked = isRunning || needsAttention;
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
	const isTwoLine = !isSettled && workspace.branch !== workspace.name;
	const [menuOpen, setMenuOpen] = useState(false);
	const openMenuFromContext = (event: MouseEvent) => {
		event.preventDefault();
		setMenuOpen(true);
	};
	const [confirmOpen, setConfirmOpen] = useState(false);
	const {
		editing,
		nameRef,
		start: startRename,
		inputProps: renameInputProps,
		onMenuCloseAutoFocus,
	} = useWorkspaceRename({
		workspace,
		canRename,
		onRename: (_target, name) => onRename(name),
	});

	const identityClass = `flex min-w-0 flex-1 gap-4 text-left ${isTwoLine ? "items-start" : "items-center"}`;
	const identityIcon = isRunning ? (
		<RunningIcon
			className={cn("size-14", isTwoLine && "mt-2", isActive ? "text-primary" : "text-text-muted")}
		/>
	) : (
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

	const reasonChip = settled ? (
		<span
			data-testid="workspace-settled-reason"
			data-reason={settled.kind}
			title={settledReasonTitle(settled, now)}
			className={cn(
				"shrink-0 rounded-full border px-4 tr-text-caption",
				settled.kind === "review" && settled.state === "merged"
					? "border-feedback-info-muted text-feedback-info"
					: settled.kind === "override"
						? "border-feedback-warning-muted text-feedback-warning"
						: "border-border-default text-text-subtle",
			)}
		>
			{settledReasonLabel(settled, now)}
		</span>
	) : null;
	const hoverAction = isSettled ? (
		<IconTooltip label="Keep active">
			<button
				type="button"
				data-testid="workspace-keep-active"
				aria-label={`Keep ${workspace.name} active`}
				onClick={onKeepActive}
				className={HOVER_CONTROL_CLASS}
			>
				<ArrowGoBack className="size-14" />
			</button>
		</IconTooltip>
	) : canSettle ? (
		<IconTooltip label={settleBlocked ? "Finish or read the result first" : "Settle"}>
			<button
				type="button"
				data-testid="workspace-settle"
				aria-label={`Settle ${workspace.name}`}
				disabled={settleBlocked}
				onClick={onSettle}
				className={HOVER_CONTROL_CLASS}
			>
				<Check className="size-14" />
			</button>
		</IconTooltip>
	) : null;

	return (
		<li>
			<fieldset
				aria-label={workspace.name}
				data-testid="workspace-item"
				data-active={isActive}
				data-kind={workspace.kind ?? "worktree"}
				data-settled={settled?.kind}
				data-attention={needsAttention || undefined}
				data-running={isRunning || undefined}
				onContextMenu={openMenuFromContext}
				className={cn(
					"group relative flex min-w-0 items-center gap-8 rounded-[var(--radius-sm)] border-0 pr-4 pl-24 transition-colors",
					isSettled ? "min-h-24 py-2" : "min-h-28 py-4",
					isActive || menuOpen ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
				)}
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
								{...renameInputProps}
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
				{reasonChip}
				{needsAttention ? <AttentionDot /> : null}
				<span
					className={cn(
						"flex shrink-0 items-center gap-4",
						isSettled &&
							"[@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:right-4 [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:rounded-[var(--radius-sm)] [@media(hover:hover)]:pl-4 [@media(hover:hover)]:group-hover:bg-control-bg-hovered",
						isSettled &&
							(isActive || menuOpen) &&
							"[@media(hover:hover)]:group-hover:bg-control-bg-selected",
						isSettled && menuOpen && "[@media(hover:hover)]:bg-control-bg-selected",
					)}
				>
					{hoverAction}
					<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
						<DropdownMenuTrigger
							data-testid="workspace-menu"
							aria-label={`Actions for ${workspace.name}`}
							className={HOVER_CONTROL_CLASS}
						>
							<MoreVertical className="size-14" />
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							data-testid="workspace-actions"
							onCloseAutoFocus={onMenuCloseAutoFocus}
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
								<DropdownMenuItem data-testid="workspace-rename" onSelect={startRename}>
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
							{canSettle ? (
								<>
									<DropdownMenuSeparator />
									{isSettled ? (
										<DropdownMenuItem
											data-testid="workspace-menu-keep-active"
											onSelect={onKeepActive}
										>
											<ArrowGoBack />
											Keep active
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem
											data-testid="workspace-menu-settle"
											disabled={settleBlocked}
											onSelect={onSettle}
										>
											<Check />
											Settle
										</DropdownMenuItem>
									)}
								</>
							) : null}
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
				</span>
			</fieldset>

			{!isDefault && (
				<RemoveWorkspaceDialog
					workspace={workspace}
					open={confirmOpen}
					onOpenChange={setConfirmOpen}
				/>
			)}
		</li>
	);
}
