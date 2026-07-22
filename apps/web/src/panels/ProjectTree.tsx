import type { HookName, HookStatus, Project, Workspace } from "@thinkrail/contracts";
import { ChevronDown, ChevronRight, Folder, GitBranch, Plus, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PopoverTrigger } from "@/components/ui/popover";
import { aggregateHookState, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { ConfirmPopover } from "./ConfirmPopover";
import { HookApprovalDialog } from "./HookApprovalDialog";
import { HookStatusIcon } from "./HookStatusIcon";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { ProjectHooksDialog } from "./ProjectHooksDialog";
import { useOpenProject } from "./useOpenProject";

/** Lower = more attention-worthy — picks a single badge when a workspace has more than one hook's status. */
const HOOK_PRIORITY: Record<HookStatus["state"], number> = {
	awaitingApproval: 0,
	failed: 1,
	running: 2,
	succeeded: 3,
};

/**
 * The one (hook, state, command) a workspace row's single badge surfaces. `state` is the per-hook
 * worst-of-both-tiers (`aggregateHookState`, worst-of Shared/Local); across a workspace's several hooks,
 * the worst-of-hooks pick still uses `HOOK_PRIORITY` unchanged (badge semantics stay as-is — only the
 * source of the state changed). `command` — needed only to open the approval dialog — is read off
 * whichever source actually produced that state, not an arbitrary tier.
 */
interface UrgentHook {
	hook: HookName;
	state: HookStatus["state"];
	command?: string | undefined;
}

function mostUrgentHook(hookStatus: Workspace["hookStatus"]): UrgentHook | null {
	let best: UrgentHook | null = null;
	for (const hook of Object.keys(hookStatus ?? {}) as HookName[]) {
		const bySource = hookStatus?.[hook];
		const state = aggregateHookState(bySource);
		if (!state) continue;
		if (!best || HOOK_PRIORITY[state] < HOOK_PRIORITY[best.state]) {
			const command = Object.values(bySource ?? {}).find((s) => s.state === state)?.command;
			best = { hook, state, command };
		}
	}
	return best;
}

/** Left-nav: projects → workspaces (git worktrees). Open a repo, select it, create/select workspaces. */
export function ProjectTree() {
	const projects = useAppStore((s) => s.projects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const workspaces = useAppStore((s) => s.workspaces);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);

	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	// The project a New-Workspace dialog is open for (null = closed). The "+" opens it instead of
	// creating a workspace directly.
	const [dialogProjectId, setDialogProjectId] = useState<string | null>(null);
	// The project a Hooks-config dialog is open for (null = closed).
	const [hooksProjectId, setHooksProjectId] = useState<string | null>(null);

	const loadWorkspaces = async (projectId: string) => {
		useAppStore
			.getState()
			.setWorkspaces(projectId, await getTransport().request("workspace.list", { projectId }));
	};

	const selectProject = async (projectId: string) => {
		const store = useAppStore.getState();
		// Selecting a project returns to its Welcome — deselect any active workspace (the shell renders the
		// Welcome when no workspace is active). The row is a deliberate "project home" gesture; the chevron
		// handles expand/collapse separately, so this never fires from just expanding. The workspace's tabs
		// survive in the store, so re-selecting it restores its view.
		store.setActiveWorkspace(null);
		store.selectProject(projectId);
		setExpanded((prev) => new Set(prev).add(projectId));
		await loadWorkspaces(projectId);
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

	return (
		<nav className="flex flex-col gap-sm">
			<header className="flex h-7 items-center justify-between pr-xs pl-sm">
				<span className="text-xs uppercase tracking-wider text-muted">Projects</span>
				<AddProjectMenu
					projects={projects}
					onOpen={() => void pickAndOpen()}
					onOpenRecent={(p) => void openProject(p)}
				>
					<Button
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
					const list = workspaces[project.id] ?? [];
					return (
						<li key={project.id}>
							<ProjectRow
								project={project}
								isSelected={selectedProjectId === project.id}
								isExpanded={isExpanded}
								workspaceCount={list.length}
								onToggle={() => toggleExpand(project.id)}
								onSelect={() => void selectProject(project.id)}
								onAddWorkspace={() => setDialogProjectId(project.id)}
								onOpenHooks={() => setHooksProjectId(project.id)}
							/>
							{isExpanded && (
								<ul className="flex flex-col">
									{list.length === 0 ? (
										<li className="py-xs pr-sm pl-xl text-xs text-hint">No workspaces yet</li>
									) : (
										list.map((ws) => (
											<WorkspaceRow
												key={ws.id}
												workspace={ws}
												isActive={activeWorkspaceId === ws.id}
												onSelect={() => useAppStore.getState().setActiveWorkspace(ws.id)}
												onRemove={() => removeWorkspace(ws.id)}
											/>
										))
									)}
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
						if (!o) setDialogProjectId(null);
					}}
					onCreated={(ws) => void onWorkspaceCreated(ws)}
				/>
			) : null}

			{hooksProjectId !== null ? (
				<ProjectHooksDialog
					open
					projectId={hooksProjectId}
					projectName={projects.find((p) => p.id === hooksProjectId)?.name ?? ""}
					onOpenChange={(o) => {
						if (!o) setHooksProjectId(null);
					}}
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
	onAddWorkspace,
	onOpenHooks,
}: {
	project: Project;
	isSelected: boolean;
	isExpanded: boolean;
	workspaceCount: number;
	onToggle: () => void;
	onSelect: () => void;
	onAddWorkspace: () => void;
	onOpenHooks: () => void;
}) {
	const Chevron = isExpanded ? ChevronDown : ChevronRight;
	return (
		<div
			data-testid="project-item"
			className="group flex h-7 items-center gap-xs rounded-[var(--radius-sm)] pr-xs pl-xs transition-colors hover:bg-hover"
		>
			<button
				type="button"
				data-testid="project-expand"
				aria-label={isExpanded ? "Collapse project" : "Expand project"}
				onClick={onToggle}
				className="flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-hint opacity-0 transition-opacity hover:text-text group-hover:opacity-100 data-[expanded=true]:opacity-100"
				data-expanded={isExpanded}
			>
				<Chevron className="size-4" />
			</button>
			<button
				type="button"
				onClick={onSelect}
				className="flex min-w-0 flex-1 items-center gap-sm text-left"
			>
				<Folder className={`size-4 shrink-0 ${isSelected ? "text-primary" : "text-muted"}`} />
				<span className={`truncate text-sm ${isSelected ? "font-medium text-text" : "text-muted"}`}>
					{project.name}
				</span>
			</button>
			{!isExpanded && workspaceCount > 0 && (
				<span className="shrink-0 text-xs text-hint group-hover:hidden">{workspaceCount}</span>
			)}
			<button
				type="button"
				data-testid="add-workspace"
				aria-label="Create workspace"
				onClick={onAddWorkspace}
				className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted opacity-0 transition hover:bg-elevated hover:text-text group-hover:opacity-100"
			>
				<Plus className="size-4" />
			</button>
			<button
				type="button"
				data-testid="project-hooks"
				aria-label="Configure hooks"
				onClick={onOpenHooks}
				className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted opacity-0 transition hover:bg-elevated hover:text-text group-hover:opacity-100"
			>
				<Settings className="size-4" />
			</button>
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
	const stats = workspace.diffStats;
	const hasStats = stats != null && (stats.added > 0 || stats.removed > 0);
	const urgentHook = mostUrgentHook(workspace.hookStatus);
	// Confirm-before-remove lives on the row so the popover anchors right beneath it (contextual to the
	// workspace being removed) rather than as a centered modal.
	const [confirmOpen, setConfirmOpen] = useState(false);
	// The approval prompt is a centered modal (approving trusts a command for the whole project, not just
	// this row) — a click on an `awaitingApproval` badge opens it directly; any other hook state instead
	// deep-links to the Hooks panel (`requestHooksView`), where output/retry live.
	const [approving, setApproving] = useState(false);
	const onHookBadgeClick = () => {
		if (!urgentHook) return;
		if (urgentHook.state === "awaitingApproval") {
			setApproving(true);
		} else {
			onSelect();
			useAppStore.getState().requestHooksView(workspace.id);
		}
	};
	return (
		<>
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
					className={`group flex min-h-7 items-center gap-sm rounded-[var(--radius-sm)] py-xs pr-xs pl-xl transition-colors ${
						isActive ? "bg-hover" : "hover:bg-hover"
					}`}
				>
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
					{urgentHook ? (
						// Unlike the diffStats indicator below, this stays visible on hover — it's actionable
						// (opens the approval dialog / deep-links to the Hooks tab), so it must survive exactly
						// the hover state a click implies.
						<button
							type="button"
							data-testid="workspace-hook-badge"
							data-hook-status={urgentHook.state}
							aria-label={`${urgentHook.hook} ${urgentHook.state}`}
							onClick={onHookBadgeClick}
							className="flex shrink-0 items-center"
						>
							<HookStatusIcon state={urgentHook.state} />
						</button>
					) : (
						hasStats && (
							<span className="shrink-0 text-xs tabular-nums group-hover:hidden">
								<span className="text-green">+{stats.added}</span>{" "}
								<span className="text-red">−{stats.removed}</span>
							</span>
						)
					)}
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
				</div>
			</ConfirmPopover>
			{urgentHook && urgentHook.state === "awaitingApproval" && urgentHook.command && (
				<HookApprovalDialog
					open={approving}
					onOpenChange={setApproving}
					projectId={workspace.projectId}
					workspaceId={workspace.id}
					hook={urgentHook.hook}
					command={urgentHook.command}
				/>
			)}
		</>
	);
}
