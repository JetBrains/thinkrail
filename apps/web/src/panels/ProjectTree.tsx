import type { Project, Workspace } from "@thinkrail/contracts";
import { FolderPlus, GitBranch, Plus, Settings, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Tip, useIsTruncated } from "@/components/Tip";
import { Button } from "@/components/ui/button";
import { PopoverTrigger } from "@/components/ui/popover";
import { selectActiveWorkspaceProjectId, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { ConfirmPopover } from "./ConfirmPopover";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { projectAvatarColor } from "./projectAvatar";
import { selectProjectWithWorkspaces } from "./selectProject";

// Full-bleed rows: negate the nav's `p-md` (`-mx-md`) so the tint reaches the panel edges, then re-inset
// the content to its normal position with existing spacing tokens (md + xs for projects, md + xl for the
// worktree indent) — only the background goes edge-to-edge; the content doesn't move.
const BLEED_PROJECT =
	"-mx-md pl-[calc(var(--spacing-md)+var(--spacing-xs))] pr-[calc(var(--spacing-md)+var(--spacing-xs))]";
const BLEED_WORKTREE =
	"-mx-md pl-[calc(var(--spacing-md)+var(--spacing-xl))] pr-[calc(var(--spacing-md)+var(--spacing-xs))]";

/** The projects list (projects → workspaces/worktrees) rendered inside `LeftPanel`. Selecting a project
 * re-enters a workspace; the chevron expands/collapses; per-project "+" cuts a new workspace. The
 * open-project (folder-open) menu sits on the PROJECTS label row here; the panel chrome (logo, collapse
 * toggle, footer) lives in `LeftPanel`. */
export function ProjectTree() {
	const projects = useAppStore((s) => s.projects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const workspaces = useAppStore((s) => s.workspaces);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);

	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	// The project a New-Workspace dialog is open for (null = closed). The "+" opens it instead of
	// creating a workspace directly.
	const [dialogProjectId, setDialogProjectId] = useState<string | null>(null);

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
		// Selecting a project re-enters its last-active workspace (falling back to the newest); Welcome
		// only shows when the project has no workspaces. The list is refreshed *before* the select so the
		// decision runs on fresh data (no Welcome flash); the chevron expands/collapses separately.
		setExpanded((prev) => new Set(prev).add(projectId));
		await selectProjectWithWorkspaces(projectId);
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

	return (
		<nav className="flex flex-col p-md">
			<div className="flex items-center justify-between px-sm">
				<span className="text-xs uppercase tracking-wider text-muted">Projects</span>
				{/* The single project-actions entry point (folder-plus): its dropdown holds the three unified
				    actions. No tooltip — a focus-opened one would overlay the project rows below it. */}
				<AddProjectMenu onAction={(id) => useAppStore.getState().openProjectDialog(id)}>
					<Button
						variant="ghost"
						size="icon"
						data-testid="add-project-menu"
						aria-label="Add project"
					>
						<FolderPlus className="size-4" />
					</Button>
				</AddProjectMenu>
			</div>

			{/* 24px below the PROJECTS header before the first item = this 18px + each block's 6px top pad. */}
			<ul className="mt-[18px] flex flex-col">
				{projects.map((project, i) => {
					const isExpanded = expanded.has(project.id);
					const list = workspaces[project.id] ?? [];
					const isSelected = selectedProjectId === project.id;
					// Exactly one item in an open group is the active (primary) one: a worktree when one is
					// active, else the project row itself (project selected + no active workspace = its ProjectView).
					const projectActive = isSelected && activeWorkspaceId === null;
					return (
						<li key={project.id}>
							{/* Edge-to-edge hairline between top-level projects only (bleeds past the nav's padding). */}
							{i > 0 ? <div aria-hidden className="-mx-md h-px bg-border2" /> : null}
							{/* Full-bleed block background (edge to edge via -mx-md, content re-inset with px-md): 6px top +
							    bottom so across a divider it reads 6|divider|6, filling up to the dividers. Collapsed → the
							    hover/active tint lives here; open → a neutral group tint (its active row/worktree tints itself). */}
							<div
								className={`-mx-md px-md py-[6px] ${
									isExpanded
										? "bg-elevated"
										: projectActive
											? "bg-[var(--primary-20)]"
											: "hover:bg-hover"
								}`}
							>
								<ProjectRow
									project={project}
									isSelected={isSelected}
									isActiveItem={projectActive}
									isExpanded={isExpanded}
									workspaceCount={list.length}
									onToggle={() => toggleExpand(project.id)}
									onSelect={() => void selectProject(project.id)}
									onOpenSettings={() => {
										// A shortcut only: open the project and jump its (already-open) rail to Hooks.
										void selectProject(project.id);
										useAppStore.getState().requestRailTab("hooks");
									}}
									onAddWorkspace={() => setDialogProjectId(project.id)}
								/>
								{isExpanded && (
									/* 6px from the project row to the first worktree (mt) and 6px between worktrees (gap). */
									<ul className="mt-[6px] flex flex-col gap-[6px]">
										{list.length === 0 ? (
											<li className="py-xs pr-sm pl-xl text-xs text-hint">No workspaces yet</li>
										) : (
											list.map((ws) => (
												<WorkspaceRow
													key={ws.id}
													workspace={ws}
													isActive={activeWorkspaceId === ws.id}
													onSelect={() => selectWorkspace(ws)}
													onRemove={() => removeWorkspace(ws.id)}
												/>
											))
										)}
									</ul>
								)}
							</div>
						</li>
					);
				})}
			</ul>

			{dialogProjectId !== null ? (
				<NewWorkspaceDialog
					open
					projectId={dialogProjectId}
					onOpenChange={(o) => {
						if (!o) setDialogProjectId(null);
					}}
					onCreated={(ws) => void onWorkspaceCreated(ws)}
				/>
			) : null}
		</nav>
	);
}

function ProjectRow({
	project,
	isSelected,
	isActiveItem,
	isExpanded,
	workspaceCount,
	onToggle,
	onSelect,
	onOpenSettings,
	onAddWorkspace,
}: {
	project: Project;
	isSelected: boolean;
	/** The one active item in the open group (project selected + no active workspace) — gets primary tint. */
	isActiveItem: boolean;
	isExpanded: boolean;
	workspaceCount: number;
	onToggle: () => void;
	onSelect: () => void;
	onOpenSettings: () => void;
	onAddWorkspace: () => void;
}) {
	// Full-name tooltip only when the row's label is actually clipped.
	const { ref: nameRef, truncated } = useIsTruncated<HTMLSpanElement>();
	const selectButton = (
		<button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center text-left">
			<span
				ref={nameRef}
				className={`truncate text-sm ${isActiveItem ? "font-medium text-text" : "text-muted"}`}
			>
				{project.name}
			</span>
		</button>
	);
	return (
		<div
			data-testid="project-item"
			data-selected={isSelected}
			// Collapsed: the tint lives on the block wrapper (content just insets with pl-xs). Open: this row
			// tints itself full-bleed (primary when it's the active item, else hover) over the group's gray.
			className={`group flex h-7 items-center gap-sm transition-colors ${
				isExpanded
					? `${BLEED_PROJECT} ${isActiveItem ? "bg-[var(--primary-20)]" : "hover:bg-hover"}`
					: "pr-xs pl-xs"
			}`}
		>
			{/* Colored per-project avatar (no chevron affordance). Clicking it toggles expand/collapse; so does
			    clicking the row (the name selects, which expands). */}
			<button
				type="button"
				data-testid="project-expand"
				aria-label={isExpanded ? "Collapse project" : "Expand project"}
				data-expanded={isExpanded}
				onClick={onToggle}
				className="shrink-0 outline-none"
			>
				<span
					aria-hidden
					className={`block size-4 rounded-[var(--radius-sm)] ${projectAvatarColor(project.id)}`}
				/>
			</button>
			{truncated ? (
				<Tip side="right" label={project.name}>
					{selectButton}
				</Tip>
			) : (
				selectButton
			)}
			{!isExpanded && workspaceCount > 0 && (
				<span className="shrink-0 text-xs text-hint group-hover:hidden">{workspaceCount}</span>
			)}
			<Tip side="right" label="Create worktree">
				<button
					type="button"
					data-testid="add-workspace"
					aria-label="Create worktree"
					onClick={onAddWorkspace}
					className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted opacity-0 transition hover:bg-elevated hover:text-text group-hover:opacity-100"
				>
					<Plus className="size-4" />
				</button>
			</Tip>
			<Tip side="right" label="Project settings">
				<button
					type="button"
					data-testid="project-settings"
					aria-label="Project settings"
					onClick={onOpenSettings}
					className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted opacity-0 transition hover:bg-elevated hover:text-text group-hover:opacity-100"
				>
					<Settings className="size-4" />
				</button>
			</Tip>
		</div>
	);
}

function WorkspaceRow({
	workspace,
	isActive,
	onSelect,
	onRemove,
}: {
	workspace: Workspace;
	isActive: boolean;
	onSelect: () => void;
	onRemove: () => void;
}) {
	// Confirm-before-remove lives on the row so the popover anchors right beneath it (contextual to the
	// workspace being removed) rather than as a centered modal.
	const [confirmOpen, setConfirmOpen] = useState(false);
	// Full name + branch tooltip, shown only when the name label is actually clipped.
	const { ref: nameRef, truncated } = useIsTruncated<HTMLSpanElement>();
	const selectButton = (
		<button
			type="button"
			onClick={onSelect}
			className="flex min-w-0 flex-1 items-center gap-sm text-left"
		>
			<GitBranch className={`size-4 shrink-0 ${isActive ? "text-primary" : "text-hint"}`} />
			{/* Name on top, the git branch on a second line beneath it — the display name is decoupled
			    from the branch, so surface both without crowding one line. The branch line is hidden when
			    they coincide, so pristine/legacy rows stay a single compact line. */}
			<span className="flex min-w-0 flex-1 flex-col">
				<span
					ref={nameRef}
					data-testid="workspace-name"
					className={`truncate text-sm leading-tight ${isActive ? "font-medium text-primary" : "text-muted"}`}
				>
					{workspace.name}
				</span>
				{workspace.branch !== workspace.name && (
					<span
						data-testid="workspace-branch"
						className="truncate font-[var(--font-mono)] text-hint text-xs leading-tight"
					>
						{workspace.branch}
					</span>
				)}
			</span>
		</button>
	);
	return (
		<ConfirmPopover
			open={confirmOpen}
			onOpenChange={setConfirmOpen}
			title={`Remove ${workspace.name} workspace`}
			description={
				<>
					Deletes this workspace's chats, terminals, and its worktree. The git branch{" "}
					<span className="font-medium text-text">{workspace.branch}</span> is kept.
				</>
			}
			confirmLabel="Remove"
			destructive
			confirmTestId="confirm-remove"
			onConfirm={onRemove}
			align="end"
		>
			{/* Anchored to the Remove button (the PopoverTrigger), right border aligned via align="end". */}
			<div
				data-testid="workspace-item"
				data-active={isActive}
				className={`group flex min-h-7 items-center gap-sm py-xs transition-colors ${BLEED_WORKTREE} ${
					isActive ? "bg-[var(--primary-20)]" : "hover:bg-hover"
				}`}
			>
				{truncated ? (
					<Tip side="right" label={`${workspace.name} · branch: ${workspace.branch}`}>
						{selectButton}
					</Tip>
				) : (
					selectButton
				)}
				<Tip side="right" label="Remove workspace">
					<PopoverTrigger asChild>
						<button
							type="button"
							data-testid="workspace-remove"
							aria-label="Remove workspace"
							className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted opacity-0 transition hover:bg-elevated hover:text-red group-hover:opacity-100 data-[state=open]:opacity-100"
						>
							<Trash2 className="size-4" />
						</button>
					</PopoverTrigger>
				</Tip>
			</div>
		</ConfirmPopover>
	);
}
