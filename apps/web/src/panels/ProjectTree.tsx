import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	MouseSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	RiArrowDownLine as ArrowDown,
	RiArrowGoBackLine as ArrowGoBack,
	RiArrowUpLine as ArrowUp,
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiFolderOpenLine as FolderOpen,
	RiMailOpenLine as MailOpen,
	RiMailUnreadLine as MailUnread,
	RiMore2Line as MoreVertical,
	RiPencilLine as Pencil,
	RiAddLine as Plus,
	RiCheckboxCircleLine,
	RiFolderLine,
	RiDeleteBin6Line as Trash2,
	RiCloseLine as X,
} from "@remixicon/react";
import type { EditorInfo, Project, Workspace, WorkspaceCreation } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { AttentionDot } from "@thinkrail/ui/attention-dot";
import { IconButton } from "@thinkrail/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	openContextMenuFromKeyboard,
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
import {
	ProjectGlyph,
	WorkspaceBranch,
	WorkspaceGlyph,
	WorkspaceLabel,
} from "@thinkrail/ui/project-tree";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { keybindingLabels } from "@/keybindings";
import { copyText } from "@/lib";
import { useNow } from "../components/useNow";
import { serversSupported } from "../remote";
import {
	isChatWorkspace,
	isDefaultWorkspace,
	isExternalWorkspace,
	SETTLED_SHELF_MORE,
	SETTLED_SHELF_PAGE,
	type SettledReason,
	selectActiveWorkspace,
	selectActiveWorkspaceProjectId,
	selectAutoSettledCounts,
	selectProjectIsRunning,
	selectProjectNeedsAttention,
	selectRepoProjects,
	selectSupportsOnboarding,
	selectWorkspaceIsRunning,
	selectWorkspaceNeedsAttention,
	selectWorkspacePartition,
	selectWorkspaceReadAction,
	settledReasonLabel,
	settledReasonTitle,
	supportsWorkspaceReadState,
	toast,
	useAppStore,
	type WorkspaceReadAction,
	workspaceName,
} from "../store";
import { errorText, getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { AddServerDialog } from "./AddServerDialog";
import { ChatsSection } from "./ChatsSection";
import { ConfirmDialog } from "./ConfirmDialog";
import { ExistingWorktreeDialog } from "./ExistingWorktreeDialog";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { RemoveWorkspaceDialog } from "./RemoveWorkspaceDialog";
import { ServerList } from "./ServerList";
import {
	announceSettledShelf,
	SETTLED_NOTICE_QUIET_MS,
	settledShelfNoticed,
} from "./settledShelfNotice";
import { startProjectSetupChat } from "./setupPrompt";
import {
	focusTreeItemOnMenuClose,
	Tree,
	treeRowControlProps,
	treeRowKey,
	treeToggleProps,
	useTreeItem,
} from "./treeNavigation";
import { useOpenProject } from "./useOpenProject";
import { WorkspaceCreationRow } from "./WorkspaceCreation";
import {
	canMoveProject,
	canRenameProject,
	canRenameWorkspace,
	canSettleWorkspace,
	loadProjectWorkspaces,
	markWorkspaceRead,
	markWorkspaceUnread,
	moveProject,
	openWorkspaceIn,
	renameProject,
	renameWorkspace,
	revealWorkspace,
	settleWorkspace,
	unsettleWorkspace,
	useEditors,
	useInlineRename,
} from "./workspaceActions";

const HOVER_CONTROL_CLASS =
	"shrink-0 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100";

type ProjectPlacement = "before" | "after";

interface ProjectDrop {
	projectId: string;
	placement: ProjectPlacement;
}

const QUIET_DRAG_ANNOUNCEMENTS = {
	onDragStart: () => undefined,
	onDragOver: () => undefined,
	onDragEnd: () => undefined,
	onDragCancel: () => undefined,
};

function groupCreationsByProject(
	creations: Record<string, WorkspaceCreation>,
): Record<string, WorkspaceCreation[]> {
	const grouped: Record<string, WorkspaceCreation[]> = {};
	for (const creation of Object.values(creations)) {
		grouped[creation.projectId] = [...(grouped[creation.projectId] ?? []), creation];
	}
	for (const list of Object.values(grouped)) list.sort((a, b) => a.startedAt - b.startedAt);
	return grouped;
}

export function ProjectTree() {
	const t = useT();
	const projects = useAppStore(useShallow(selectRepoProjects));
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const workspaces = useAppStore((s) => s.workspaces);
	const workspaceCreations = useAppStore((s) => s.workspaceCreations);
	const activeCreationId = useAppStore((s) => s.activeCreationId);
	const creationsByProject = groupCreationsByProject(workspaceCreations);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspaceLiveLatch = useAppStore((s) => s.activeWorkspaceLiveLatch);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const supportsCreate = useAppStore(selectSupportsOnboarding);
	const supportsSettling = useAppStore((s) => s.workspaceSettlingSupported);
	const sessionStateByWorkspace = useAppStore((s) => s.sessionStateByWorkspace);
	const settleIdleDays = useAppStore((s) => s.settleIdleDays);
	const settledShelfExpanded = useAppStore((s) => s.settledShelfExpanded);
	const settledShelfShown = useAppStore((s) => s.settledShelfShown);
	const now = useNow();
	const canMove = canMoveProject(protocolVersion);
	const dragSensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }));
	const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
	const [moveAnnouncement, setMoveAnnouncement] = useState("");
	const draggingIndex = projects.findIndex((project) => project.id === draggingProjectId);
	const draggingProject = projects[draggingIndex];

	const editors = useEditors();

	const expandedProjectIds = useAppStore((s) => s.expandedProjectIds);
	const [dialogProjectId, setDialogProjectId] = useState<string | null>(null);
	const [existingDialogProjectId, setExistingDialogProjectId] = useState<string | null>(null);
	const [addingServer, setAddingServer] = useState(false);
	const withServers = serversSupported();
	const addProjectButtonRef = useRef<HTMLButtonElement>(null);
	const projectNameButtonsRef = useRef(new Map<string, HTMLButtonElement>());
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

	const activeProjectId = useAppStore(selectActiveWorkspaceProjectId);
	const activeIsChat = useAppStore((s) => {
		const active = selectActiveWorkspace(s);
		return active !== null && isChatWorkspace(active);
	});
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

	const autoSettledKey = selectAutoSettledCounts(partitionState, now)
		.map(({ projectId, count }) => `${projectId}:${count}`)
		.join(",");
	useEffect(() => {
		if (autoSettledKey === "" || settledShelfNoticed()) return;
		const timer = setTimeout(announceSettledShelf, SETTLED_NOTICE_QUIET_MS);
		return () => clearTimeout(timer);
	}, [autoSettledKey]);

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

	const { openProject, pickAndOpen, enterHostPath, startNewProject, cloneRepository, dialogs } =
		useOpenProject(async (project, { setup }) => {
			await selectProject(project.id).catch(() => {});
			if (setup) await startProjectSetupChat(project.id);
		});

	const onExistingWorktreeOpened = async (workspace: Workspace) => {
		const rows = await getTransport().request("workspace.list", {
			projectId: workspace.projectId,
		});
		const attached = rows.find((candidate) => candidate.id === workspace.id);
		if (!attached) throw new Error(t("panels.projectTree.attachedWorktreeMissing"));
		const store = useAppStore.getState();
		store.expandProject(workspace.projectId);
		store.setWorkspaces(workspace.projectId, rows);
		store.activateWorkspace(attached);
	};

	const closeProject = (project: Project) => {
		void getTransport()
			.request("project.close", { id: project.id })
			.catch((err) => {
				toast.error(errorText(err, t("panels.projectTree.closeFailed", { name: project.name })));
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

	const move = async (
		project: Project,
		targetId: string,
		placement: ProjectPlacement,
		restoreFocus: boolean,
	) => {
		if (!(await moveProject(project.id, targetId, placement))) return;
		const order = selectRepoProjects(useAppStore.getState());
		const position = order.findIndex((candidate) => candidate.id === project.id) + 1;
		if (position > 0) {
			setMoveAnnouncement(
				t("panels.projectTree.moved", { name: project.name, position, total: order.length }),
			);
		}
		if (restoreFocus) focusProjectNameOrAdd(project.id);
	};

	const dropProject = ({ active, over }: DragEndEvent) => {
		setDraggingProjectId(null);
		const drop = over?.data.current as ProjectDrop | undefined;
		const current = selectRepoProjects(useAppStore.getState());
		const project = current.find((candidate) => candidate.id === active.id);
		if (!drop || !project || !current.some((candidate) => candidate.id === drop.projectId)) return;
		void move(project, drop.projectId, drop.placement, false);
	};

	return (
		<nav data-testid="project-tree" className="flex flex-col gap-4">
			<ChatsSection />
			<header className="flex h-panel-row items-center justify-between pr-4 pl-8">
				<span className="tr-text-eyebrow text-text-muted">{t("panels.projectTree.title")}</span>
				<AddProjectMenu
					recentProjects={recentProjects}
					onOpen={() => void pickAndOpen()}
					onEnterHostPath={enterHostPath}
					onClone={cloneRepository}
					onOpenRecent={(p) => void openProject(p)}
					{...(supportsCreate ? { onStartNew: startNewProject } : {})}
					{...(withServers ? { onAddServer: () => setAddingServer(true) } : {})}
				>
					<IconButton
						ref={addProjectButtonRef}
						icon={Plus}
						label={t("panels.projectTree.addProject")}
						variant="ghost"
						size="s"
						data-testid="add-project-menu"
						data-focus-fallback="projects"
					/>
				</AddProjectMenu>
			</header>

			<p role="status" aria-live="polite" data-testid="project-move-status" className="sr-only">
				{moveAnnouncement}
			</p>
			<DndContext
				sensors={dragSensors}
				collisionDetection={pointerWithin}
				accessibility={{
					announcements: QUIET_DRAG_ANNOUNCEMENTS,
					screenReaderInstructions: { draggable: t("panels.projectTree.reorderInstructions") },
				}}
				onDragStart={({ active }) => setDraggingProjectId(String(active.id))}
				onDragCancel={() => setDraggingProjectId(null)}
				onDragEnd={dropProject}
			>
				<Tree
					label={t("panels.projectTree.title")}
					focusList="projects"
					className="flex flex-col"
					focusDefault={!activeIsChat}
				>
					{projects.map((project, index) => {
						const isExpanded = expandedProjectIds[project.id] === true;
						const list = workspaces[project.id];
						const stateProjection = { sessionStateByWorkspace };
						const previous = projects[index - 1];
						const next = projects[index + 1];
						return (
							<li
								key={project.id}
								role="none"
								data-testid="project-group"
								data-focus-row={project.id}
								data-dragging={draggingProjectId === project.id || undefined}
								className="relative data-[dragging]:opacity-40"
							>
								<ProjectDropZone
									projectId={project.id}
									placement="before"
									enabled={
										draggingIndex >= 0 && index !== draggingIndex && index !== draggingIndex + 1
									}
								/>
								<ProjectDropZone
									projectId={project.id}
									placement="after"
									enabled={
										draggingIndex >= 0 && index !== draggingIndex && index !== draggingIndex - 1
									}
								/>
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
									canRename={canRenameProject(protocolVersion)}
									onRename={(name) => renameProject(project, name)}
									onClose={() => closeProject(project)}
									onAddWorkspace={() => openWorkspaceDialog(project.id, false)}
									onAddWorkspaceFromMenu={() => openWorkspaceDialog(project.id, true)}
									onOpenExistingWorktree={() => openExistingWorktreeDialog(project.id)}
									onRegisterNameButton={(element) => registerProjectNameButton(project.id, element)}
									onRestoreFocus={() => focusProjectNameOrAdd(project.id)}
									canMove={canMove}
									onMoveUp={
										previous ? () => void move(project, previous.id, "before", true) : undefined
									}
									onMoveDown={next ? () => void move(project, next.id, "after", true) : undefined}
								/>
								{isExpanded && list === undefined && (
									<LoadingRegion rows={2} className="py-4 pr-8 pl-16" />
								)}
								{isExpanded && list !== undefined && (
									<SettledPartition
										enabled={supportsSettling}
										projectId={project.id}
										partition={selectWorkspacePartition(partitionState, project.id, now)}
										shelfExpanded={settledShelfExpanded[project.id] === true}
										shelfShown={settledShelfShown[project.id] ?? SETTLED_SHELF_PAGE}
										renderRow={(ws, settled) =>
											workspaceCreations[ws.id] ? null : (
												<WorkspaceRow
													key={ws.id}
													workspace={ws}
													level={settled ? 3 : 2}
													settled={settled}
													now={now}
													isActive={activeWorkspaceId === ws.id}
													needsAttention={selectWorkspaceNeedsAttention(stateProjection, ws.id)}
													isRunning={selectWorkspaceIsRunning(stateProjection, ws.id)}
													canRename={canRenameWorkspace(protocolVersion, ws)}
													canSettle={canSettleWorkspace(protocolVersion, ws)}
													readAction={
														supportsWorkspaceReadState(protocolVersion)
															? selectWorkspaceReadAction(stateProjection, ws.id)
															: null
													}
													editors={editors}
													onSelect={() => selectWorkspace(ws)}
													onOpenIn={(editor) => openWorkspaceIn(ws, editor)}
													onCopyPath={() => void copyText(ws.worktreePath)}
													onReveal={() => revealWorkspace(ws)}
													onRename={(name) => renameWorkspace(ws, name)}
													onSettle={() => settleWorkspace(ws.id)}
													onKeepActive={() => unsettleWorkspace(ws.id)}
													onMarkRead={() => markWorkspaceRead(ws.id)}
													onMarkUnread={() => markWorkspaceUnread(ws.id)}
												/>
											)
										}
									/>
								)}
								{isExpanded && (creationsByProject[project.id]?.length ?? 0) > 0 && (
									<ul role="none" data-focus-list={`workspaces:${project.id}`}>
										{creationsByProject[project.id]?.map((creation) => (
											<WorkspaceCreationRow
												key={creation.id}
												creation={creation}
												isActive={activeCreationId === creation.id}
												onSelect={() => useAppStore.getState().selectCreation(creation.id)}
											/>
										))}
									</ul>
								)}
							</li>
						);
					})}
				</Tree>
				<DragOverlay dropAnimation={null}>
					{draggingProject ? (
						<div className="flex max-w-224 items-center gap-4 rounded-sm border border-primary bg-container-elevated-bg px-8 py-4 tr-text-ui text-text-default shadow-lg">
							<RiFolderLine className="size-14 shrink-0 text-text-muted" />
							<span className="truncate">{draggingProject.name}</span>
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
			{withServers ? <ServerList onAddServer={() => setAddingServer(true)} /> : null}
			{addingServer ? <AddServerDialog onClose={() => setAddingServer(false)} /> : null}

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

function ProjectDropZone({
	projectId,
	placement,
	enabled,
}: {
	projectId: string;
	placement: ProjectPlacement;
	enabled: boolean;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: `${placement}:${projectId}`,
		data: { projectId, placement } satisfies ProjectDrop,
		disabled: !enabled,
	});
	return (
		<div
			ref={setNodeRef}
			aria-hidden="true"
			data-placement={placement}
			data-drop-active={isOver || undefined}
			className={cn(
				"pointer-events-none absolute inset-x-0 z-10 h-1/2 border-primary",
				placement === "before"
					? "top-0 data-[drop-active]:border-t-2"
					: "bottom-0 data-[drop-active]:border-b-2",
			)}
		/>
	);
}

function SettledPartition({
	enabled,
	projectId,
	partition,
	shelfExpanded,
	shelfShown,
	renderRow,
}: {
	enabled: boolean;
	projectId: string;
	partition: ReturnType<typeof selectWorkspacePartition>;
	shelfExpanded: boolean;
	shelfShown: number;
	renderRow: (workspace: Workspace, settled: SettledReason | null) => ReactNode;
}) {
	const t = useT();
	const settledCount = partition.settled.length;
	const shown = partition.settled.slice(0, shelfShown);
	const remaining = settledCount - shown.length;
	const shelfLabel = t("panels.projectTree.settledShelf", { total: settledCount });
	const moreLabel = t("panels.projectTree.showMore", {
		count: Math.min(SETTLED_SHELF_MORE, remaining),
	});
	const shelfItem = useTreeItem(`settled:${projectId}`, {
		level: 2,
		label: shelfLabel,
		expanded: shelfExpanded,
		toggles: true,
	});
	const moreItem = useTreeItem(`settled-more:${projectId}`, { level: 3, label: moreLabel });
	if (!enabled) {
		return (
			<ul
				role="none"
				data-focus-list={`workspaces:${projectId}`}
				className="mt-2 flex flex-col gap-2 motion-safe:animate-reveal"
			>
				{partition.live.map((workspace) => renderRow(workspace, null))}
			</ul>
		);
	}
	return (
		<div className="mt-2 flex flex-col gap-2 motion-safe:animate-reveal">
			<ul role="none" data-focus-list={`workspaces:${projectId}`} className="flex flex-col gap-2">
				{partition.live.map((ws) => renderRow(ws, null))}
			</ul>
			<div
				data-testid="settled-shelf"
				data-count={settledCount}
				data-expanded={shelfExpanded}
				className="flex h-panel-row min-w-0 items-center gap-4 rounded-sm pr-4 pl-12 text-text-subtle tr-text-metadata hover:bg-control-bg-hovered"
			>
				<button
					type="button"
					{...shelfItem}
					data-testid="settled-shelf-toggle"
					data-focus-fallback={`settled:${projectId}`}
					onClick={() => useAppStore.getState().toggleSettledShelf(projectId)}
					className="-mx-4 -my-2 flex min-w-0 flex-1 items-center gap-4 rounded-sm px-4 py-2 text-left focus-visible:focus-ring-inset"
				>
					{shelfExpanded ? (
						<ChevronDown className="size-14 shrink-0" />
					) : (
						<ChevronRight className="size-14 shrink-0" />
					)}
					<RiCheckboxCircleLine className="size-14 shrink-0" />
					<span className="truncate">{shelfLabel}</span>
				</button>
			</div>
			{shelfExpanded ? (
				<ul
					role="none"
					className="flex flex-col gap-2"
					data-testid="settled-shelf-rows"
					data-focus-list={`settled:${projectId}`}
				>
					{settledCount === 0 ? (
						<li role="none" className="py-4 pr-4 pl-24 text-text-subtle tr-text-metadata">
							{t("panels.projectTree.nothingSettled")}
						</li>
					) : (
						shown.map((row) => renderRow(row.workspace, row.reason))
					)}
					{remaining > 0 ? (
						<li role="none">
							<button
								type="button"
								{...moreItem}
								data-testid="settled-shelf-more"
								onClick={() =>
									useAppStore.getState().showMoreSettled(projectId, shelfShown + SETTLED_SHELF_MORE)
								}
								className="flex h-panel-row w-full items-center rounded-sm pl-24 text-left text-text-subtle tr-text-metadata hover:bg-control-bg-hovered hover:text-text-muted focus-visible:focus-ring-inset"
							>
								{moreLabel}
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
	canRename,
	onRename,
	onClose,
	onAddWorkspace,
	onAddWorkspaceFromMenu,
	onOpenExistingWorktree,
	onRegisterNameButton,
	onRestoreFocus,
	canMove,
	onMoveUp,
	onMoveDown,
}: {
	project: Project;
	isSelected: boolean;
	isExpanded: boolean;
	needsAttention: boolean;
	isRunning: boolean;
	workspaceCount: number;
	onToggle: () => void;
	onSelect: () => void;
	canRename: boolean;
	onRename: (name: string) => void;
	onClose: () => void;
	onAddWorkspace: () => void;
	onAddWorkspaceFromMenu: () => void;
	onOpenExistingWorktree: () => void;
	onRegisterNameButton: (element: HTMLButtonElement | null) => void;
	onRestoreFocus: () => void;
	canMove: boolean;
	onMoveUp: (() => void) | undefined;
	onMoveDown: (() => void) | undefined;
}) {
	const t = useT();
	const draggable = canMove && (onMoveUp !== undefined || onMoveDown !== undefined);
	const {
		attributes: dragAttributes,
		listeners: dragListeners,
		setNodeRef: setDragNode,
	} = useDraggable({ id: project.id, disabled: !draggable });
	const [newWorkspaceShortcut = "", newWorkspaceAlias = ""] = keybindingLabels("workspace.new");
	const createWorkspaceLabel = t("panels.projectTree.createWorkspaceShortcut", {
		shortcut: newWorkspaceShortcut,
		altShortcut: newWorkspaceAlias,
	});
	const Chevron = isExpanded ? ChevronDown : ChevronRight;
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const openingDialogRef = useRef(false);
	const closeConfirmedRef = useRef(false);
	const {
		editing,
		nameRef,
		start: startRename,
		inputProps: renameInputProps,
	} = useInlineRename({
		target: project,
		canRename,
		onRename: (_target, name) => onRename(name),
	});
	const treeItem = useTreeItem(project.id, {
		level: 1,
		label: project.name,
		expanded: isExpanded,
		selected: isSelected,
	});
	const folderIcon = <ProjectGlyph selected={isSelected} running={isRunning} />;
	const nameClass = `truncate tr-text-ui ${isSelected ? "text-text-default" : "text-text-muted"}`;
	const openDialogAfterMenu = (openDialog: () => void) => {
		openingDialogRef.current = true;
		setMenuOpen(false);
		requestAnimationFrame(openDialog);
	};
	const row = (
		<div
			data-testid="project-item"
			data-row
			data-menu-open={menuOpen}
			data-attention={needsAttention || undefined}
			data-running={isRunning || undefined}
			className={`group flex h-panel-row items-center gap-4 rounded-sm pr-4 pl-4 transition-colors ${
				menuOpen ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered"
			}`}
		>
			<button
				type="button"
				{...treeToggleProps(project.id)}
				data-testid="project-expand"
				aria-label={
					isExpanded
						? t("panels.projectTree.collapseProject")
						: t("panels.projectTree.expandProject")
				}
				onClick={onToggle}
				className="flex size-16 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors hover:text-text-default focus-visible:text-text-default focus-visible:focus-ring"
				data-expanded={isExpanded}
			>
				<Chevron className="size-16" />
			</button>
			{editing ? (
				<div className="flex min-w-0 flex-1 items-center gap-4">
					{folderIcon}
					<input
						ref={nameRef}
						data-testid="project-name-input"
						type="text"
						spellCheck={false}
						aria-label={t("panels.projectTree.projectName")}
						defaultValue={project.name}
						{...renameInputProps}
						className={cn(
							"w-full min-w-0 border-0 bg-transparent p-0 focus-visible:focus-ring",
							nameClass,
						)}
					/>
				</div>
			) : (
				<button
					ref={(element) => {
						setDragNode(element);
						onRegisterNameButton(element);
					}}
					type="button"
					{...treeItem}
					data-testid="project-name"
					data-focus-row-primary
					aria-describedby={draggable ? dragAttributes["aria-describedby"] : undefined}
					aria-keyshortcuts={canMove ? "Alt+Shift+ArrowUp Alt+Shift+ArrowDown" : undefined}
					{...(draggable ? dragListeners : {})}
					onKeyDown={(event) => {
						const key = treeRowKey(event);
						if (key === "rename" && canRename) {
							event.preventDefault();
							startRename();
							return;
						}
						if (key === "delete") {
							event.preventDefault();
							setConfirmOpen(true);
							return;
						}
						if (!canMove) return;
						if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
						if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
						event.preventDefault();
						(event.key === "ArrowUp" ? onMoveUp : onMoveDown)?.();
					}}
					onClick={onSelect}
					className="-mx-4 -my-2 flex min-w-0 flex-1 items-center gap-4 rounded-sm px-4 py-2 text-left focus-visible:focus-ring-inset"
				>
					{folderIcon}
					<span className={nameClass}>{project.name}</span>
				</button>
			)}
			{needsAttention ? <AttentionDot /> : null}
			{!isExpanded && workspaceCount > 0 && (
				<span
					data-testid="project-workspace-count"
					className="shrink-0 tr-text-metadata text-text-muted"
				>
					{workspaceCount}
				</span>
			)}
			<IconButton
				icon={Plus}
				label={createWorkspaceLabel}
				variant="ghost"
				size="s"
				className="shrink-0"
				{...treeRowControlProps}
				data-testid="add-workspace"
				data-focus-fallback={`workspaces:${project.id}`}
				onClick={onAddWorkspace}
			/>
		</div>
	);
	return (
		<>
			<ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
				<ContextMenuTrigger asChild onKeyDown={openContextMenuFromKeyboard}>
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
						{t("panels.projectTree.createWorkspace")}
					</ContextMenuItem>
					<ContextMenuItem
						data-testid="project-menu-open-existing-worktree"
						onSelect={(event) => {
							event.preventDefault();
							openDialogAfterMenu(onOpenExistingWorktree);
						}}
					>
						<FolderOpen />
						{t("panels.projectTree.openExistingWorktree")}
					</ContextMenuItem>
					<ContextMenuSeparator />
					{canMove ? (
						<>
							<ContextMenuItem
								data-testid="project-menu-move-up"
								disabled={!onMoveUp}
								onSelect={() => onMoveUp?.()}
							>
								<ArrowUp />
								{t("panels.projectTree.moveUp")}
							</ContextMenuItem>
							<ContextMenuItem
								data-testid="project-menu-move-down"
								disabled={!onMoveDown}
								onSelect={() => onMoveDown?.()}
							>
								<ArrowDown />
								{t("panels.projectTree.moveDown")}
							</ContextMenuItem>
							<ContextMenuSeparator />
						</>
					) : null}
					{canRename ? (
						<ContextMenuItem
							data-testid="project-menu-rename"
							onSelect={() => {
								openingDialogRef.current = true;
								startRename();
							}}
						>
							<Pencil />
							{t("common.rename")}
						</ContextMenuItem>
					) : null}
					<ContextMenuItem
						data-testid="project-menu-close"
						onSelect={(event) => {
							event.preventDefault();
							openDialogAfterMenu(() => setConfirmOpen(true));
						}}
					>
						<X />
						{t("panels.projectTree.closeProject")}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={t("panels.projectTree.closeTitle", { name: project.name })}
				description={t("panels.projectTree.closeDescription")}
				confirmLabel={t("panels.projectTree.closeProject")}
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
	level,
	settled,
	now,
	isActive,
	needsAttention,
	isRunning,
	canRename,
	canSettle,
	readAction,
	editors,
	onSelect,
	onOpenIn,
	onCopyPath,
	onReveal,
	onRename,
	onSettle,
	onKeepActive,
	onMarkRead,
	onMarkUnread,
}: {
	workspace: Workspace;
	level: number;
	settled: SettledReason | null;
	now: number;
	isActive: boolean;
	needsAttention: boolean;
	isRunning: boolean;
	canRename: boolean;
	canSettle: boolean;
	readAction: WorkspaceReadAction | null;
	editors: EditorInfo[];
	onSelect: () => void;
	onOpenIn: (editor: EditorInfo) => void;
	onCopyPath: () => void;
	onReveal: () => void;
	onRename: (name: string) => void;
	onSettle: () => void;
	onKeepActive: () => void;
	onMarkRead: () => void;
	onMarkUnread: () => void;
}) {
	const t = useT();
	const isDefault = isDefaultWorkspace(workspace);
	const isExternal = isExternalWorkspace(workspace);
	const isSettled = settled !== null;
	const settleBlocked = isRunning || needsAttention;
	const isTwoLine = !isSettled && workspace.branch !== workspace.name;
	const displayName = workspaceName(t, workspace);
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
	} = useInlineRename({
		target: workspace,
		canRename,
		onRename: (_target, name) => onRename(name),
	});
	const rowRef = useRef<HTMLDivElement>(null);
	const treeItem = useTreeItem(workspace.id, { level, label: displayName, selected: isActive });

	const identityClass = `-mx-4 -my-2 flex min-w-0 flex-1 gap-4 rounded-sm px-4 py-2 text-left focus-visible:focus-ring-inset ${isTwoLine ? "items-start" : "items-center"}`;
	const identityIcon = (
		<WorkspaceGlyph
			kind={workspace.kind}
			active={isActive}
			running={isRunning}
			twoLine={isTwoLine}
		/>
	);
	const branchLabel = isTwoLine ? <WorkspaceBranch branch={workspace.branch} /> : null;

	const reasonChip = settled ? (
		<span
			data-testid="workspace-settled-reason"
			data-reason={settled.kind}
			title={settledReasonTitle(t, settled, now)}
			className={cn(
				"shrink-0 rounded-full border px-4 tr-text-caption",
				settled.kind === "review" && settled.state === "merged"
					? "border-feedback-info-muted text-feedback-info"
					: settled.kind === "override"
						? "border-feedback-warning-muted text-feedback-warning"
						: "border-border-default text-text-subtle",
			)}
		>
			{settledReasonLabel(t, settled, now)}
		</span>
	) : null;
	const hoverAction = isSettled ? (
		<IconButton
			icon={ArrowGoBack}
			label={t("panels.projectTree.keepActiveLabel", { name: displayName })}
			tooltip={t("panels.projectTree.keepActive")}
			variant="ghost"
			size="s"
			data-testid="workspace-keep-active"
			{...treeRowControlProps}
			onClick={onKeepActive}
			className={HOVER_CONTROL_CLASS}
		/>
	) : canSettle ? (
		<IconButton
			icon={Check}
			label={t("panels.projectTree.settleLabel", { name: displayName })}
			tooltip={
				settleBlocked ? t("panels.projectTree.settleBlocked") : t("panels.projectTree.settle")
			}
			wrapTrigger
			variant="ghost"
			size="s"
			data-testid="workspace-settle"
			{...treeRowControlProps}
			disabled={settleBlocked}
			onClick={onSettle}
			className={HOVER_CONTROL_CLASS}
		/>
	) : null;

	return (
		<li role="none">
			<div
				ref={rowRef}
				role="none"
				data-testid="workspace-item"
				data-row
				data-focus-row={workspace.id}
				data-active={isActive}
				data-kind={workspace.kind ?? "worktree"}
				data-settled={settled?.kind}
				data-attention={needsAttention || undefined}
				data-running={isRunning || undefined}
				onContextMenu={openMenuFromContext}
				className={cn(
					"group relative flex min-h-panel-row min-w-0 items-center gap-8 rounded-sm py-2 pr-4 pl-24 transition-colors",
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
								aria-label={t("panels.projectTree.workspaceName")}
								defaultValue={workspace.name}
								{...renameInputProps}
								className={`w-full min-w-0 truncate border-0 bg-transparent p-0 tr-text-ui leading-tight focus-visible:focus-ring ${isActive ? "text-primary" : "text-text-muted"}`}
							/>
							{branchLabel}
						</span>
					</div>
				) : (
					<button
						type="button"
						{...treeItem}
						data-focus-row-primary
						onClick={onSelect}
						onKeyDown={(event) => {
							const key = treeRowKey(event);
							if (key === "menu") setMenuOpen(true);
							else if (key === "rename" && canRename) startRename();
							else if (key === "delete" && !isDefault) setConfirmOpen(true);
							else return;
							event.preventDefault();
						}}
						className={identityClass}
					>
						{identityIcon}
						<WorkspaceLabel
							name={displayName}
							branch={isTwoLine ? workspace.branch : undefined}
							active={isActive}
						/>
					</button>
				)}
				{reasonChip}
				{needsAttention ? <AttentionDot /> : null}
				<span
					className={cn(
						"flex shrink-0 items-center gap-4",
						isSettled &&
							"[@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:right-4 [@media(hover:hover)]:-translate-y-1/2 [@media(hover:hover)]:rounded-sm [@media(hover:hover)]:pl-4 [@media(hover:hover)]:group-hover:bg-control-bg-hovered",
						isSettled &&
							(isActive || menuOpen) &&
							"[@media(hover:hover)]:group-hover:bg-control-bg-selected",
						isSettled && menuOpen && "[@media(hover:hover)]:bg-control-bg-selected",
					)}
				>
					{hoverAction}
					<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
						<DropdownMenuTrigger asChild>
							<IconButton
								icon={MoreVertical}
								label={t("panels.projectTree.workspaceActions", { name: displayName })}
								variant="ghost"
								size="s"
								data-testid="workspace-menu"
								{...treeRowControlProps}
								className={HOVER_CONTROL_CLASS}
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							data-testid="workspace-actions"
							onCloseAutoFocus={(event) => {
								onMenuCloseAutoFocus(event);
								if (!event.defaultPrevented) focusTreeItemOnMenuClose(event, rowRef.current);
							}}
						>
							{editors.length > 0 && (
								<DropdownMenuSub>
									<DropdownMenuSubTrigger data-testid="workspace-open-in">
										<ExternalLink />
										{t("panels.projectTree.openIn")}
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
									{t("common.rename")}
								</DropdownMenuItem>
							) : null}
							<DropdownMenuItem data-testid="workspace-copy-path" onSelect={onCopyPath}>
								<Copy />
								{t("panels.projectTree.copyPath")}
							</DropdownMenuItem>
							<DropdownMenuItem data-testid="workspace-reveal" onSelect={onReveal}>
								<FolderOpen />
								{t("panels.projectTree.reveal")}
							</DropdownMenuItem>
							{readAction !== null || isSettled || canSettle ? <DropdownMenuSeparator /> : null}
							{readAction === "markRead" ? (
								<DropdownMenuItem data-testid="workspace-mark-read" onSelect={onMarkRead}>
									<MailOpen />
									{t("panels.projectTree.markRead")}
								</DropdownMenuItem>
							) : readAction === "markUnread" ? (
								<DropdownMenuItem data-testid="workspace-mark-unread" onSelect={onMarkUnread}>
									<MailUnread />
									{t("panels.projectTree.markUnread")}
								</DropdownMenuItem>
							) : null}
							{isSettled ? (
								<DropdownMenuItem data-testid="workspace-menu-keep-active" onSelect={onKeepActive}>
									<ArrowGoBack />
									{t("panels.projectTree.keepActive")}
								</DropdownMenuItem>
							) : canSettle ? (
								<DropdownMenuItem
									data-testid="workspace-menu-settle"
									disabled={settleBlocked}
									onSelect={onSettle}
								>
									<Check />
									{t("panels.projectTree.settle")}
								</DropdownMenuItem>
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
										{isExternal
											? t("panels.projectTree.removeExternal")
											: t("panels.projectTree.removeWorkspace")}
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</span>
			</div>

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
