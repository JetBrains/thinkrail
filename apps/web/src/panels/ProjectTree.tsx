import type { Project, Workspace } from "@thinkrail/contracts";
import { ChevronDown, ChevronRight, Folder, GitBranch, Globe, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PopoverTrigger } from "@/components/ui/popover";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConfirmPopover } from "./ConfirmPopover";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { NoticeDialog } from "./NoticeDialog";

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
	// A plain folder we've offered to `git init` (null = closed) — set when `project.open` fails and the
	// host reports the path is `initable`.
	const [initTarget, setInitTarget] = useState<string | null>(null);
	// A non-actionable open failure to surface (a stale recent, a broken path). null = no notice.
	const [openError, setOpenError] = useState<string | null>(null);

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

	// Record a freshly opened/initialised project in the store and select it.
	const adoptProject = async (projectId: string) => {
		useAppStore.getState().setProjects(await getTransport().request("project.list", {}));
		await selectProject(projectId);
	};

	const openProject = async (rawPath: string) => {
		const trimmed = rawPath.trim();
		if (!trimmed) return;
		try {
			const project = await getTransport().request("project.open", { path: trimmed });
			await adoptProject(project.id);
		} catch (err) {
			// Open failed — the common case is a plain (non-git) folder. Ask the host what the path is so we
			// either offer to initialise a repo or surface a legible error, instead of failing silently.
			const status = await getTransport()
				.request("project.inspect", { path: trimmed })
				.catch(() => null);
			if (status?.kind === "initable") setInitTarget(trimmed);
			else if (status?.kind === "missing")
				setOpenError(`This folder no longer exists:\n${trimmed}`);
			else if (status?.kind === "notDirectory") setOpenError(`This isn't a folder:\n${trimmed}`);
			else setOpenError(errorText(err, `Couldn't open ${trimmed}.`));
		}
	};

	// Confirmed the init offer: `git init` + commit the folder, then open it as a project.
	const initProject = async (path: string) => {
		try {
			const project = await getTransport().request("project.init", { path });
			await adoptProject(project.id);
		} catch (err) {
			setOpenError(errorText(err, `Couldn't initialise a git repository in ${path}.`));
		}
	};

	/** "Open project" → ask the host for a directory via its native picker, then open it. */
	const pickAndOpen = async () => {
		try {
			const { path } = await getTransport().request("dialog.selectDirectory", {});
			if (path) await openProject(path);
		} catch {
			// Cancelled / unavailable — nothing to do.
		}
	};

	// After the dialog creates a workspace: expand its project + reload the list (the dialog itself sets
	// the active workspace and kicks off any chat).
	const onWorkspaceCreated = async (workspace: Workspace) => {
		setExpanded((prev) => new Set(prev).add(workspace.projectId));
		await loadWorkspaces(workspace.projectId);
	};

	// Optimistic removal: drop the row + its tabs now, then fire the request without blocking the UI (the
	// host acks fast and reclaims the worktree in the background). A failed delete reconciles by re-listing.
	const removeWorkspace = (projectId: string, workspaceId: string) => {
		const store = useAppStore.getState();
		store.removeWorkspace(projectId, workspaceId);
		store.clearWorkspaceTabs(workspaceId);
		if (activeWorkspaceId === workspaceId) store.setActiveWorkspace("");
		void getTransport()
			.request("workspace.remove", { id: workspaceId })
			.catch(() => void loadWorkspaces(projectId));
	};

	return (
		<nav className="flex flex-col gap-sm">
			<header className="flex h-7 items-center justify-between pr-xs pl-sm">
				<span className="text-xs uppercase tracking-wider text-muted">Projects</span>
				<AddProjectMenu
					projects={projects}
					onOpen={() => void pickAndOpen()}
					onOpenRecent={(p) => void openProject(p)}
				/>
			</header>

			{projects.length === 0 ? (
				<EmptyState onOpen={() => void pickAndOpen()} />
			) : (
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
													onRemove={() => removeWorkspace(project.id, ws.id)}
												/>
											))
										)}
									</ul>
								)}
							</li>
						);
					})}
				</ul>
			)}

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

			<ConfirmDialog
				open={initTarget !== null}
				onOpenChange={(o) => {
					if (!o) setInitTarget(null);
				}}
				title="Initialize a git repository?"
				description={
					<>
						<span className="font-medium text-text">{initTarget}</span> isn't a git repository.
						ThinkRail works on git worktrees, so it needs one. Initialize a repo here and commit the
						folder's current contents?
					</>
				}
				confirmLabel="Initialize & open"
				confirmTestId="confirm-init-repo"
				onConfirm={() => {
					if (initTarget) void initProject(initTarget);
				}}
			/>

			<NoticeDialog
				open={openError !== null}
				onOpenChange={(o) => {
					if (!o) setOpenError(null);
				}}
				title="Couldn't open project"
				description={<span className="whitespace-pre-line">{openError}</span>}
				testId="open-error-dialog"
			/>
		</nav>
	);
}

function AddProjectMenu({
	projects,
	onOpen,
	onOpenRecent,
}: {
	projects: Project[];
	onOpen: () => void;
	onOpenRecent: (path: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" data-testid="add-project-menu" aria-label="Add project">
					<Plus className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem data-testid="menu-open-project" onSelect={() => onOpen()}>
					<Folder />
					<span>Open project</span>
				</DropdownMenuItem>
				<DropdownMenuItem disabled>
					<Globe />
					<span>Open GitHub project</span>
				</DropdownMenuItem>
				{projects.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Recents</DropdownMenuLabel>
						<DropdownMenuGroup>
							{projects.map((project) => (
								<DropdownMenuItem
									key={project.id}
									onSelect={() => onOpenRecent(project.path)}
									title={project.path}
								>
									<Folder />
									<span className="truncate">{project.path}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
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
}: {
	project: Project;
	isSelected: boolean;
	isExpanded: boolean;
	workspaceCount: number;
	onToggle: () => void;
	onSelect: () => void;
	onAddWorkspace: () => void;
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
	// Confirm-before-remove lives on the row so the popover anchors right beneath it (contextual to the
	// workspace being removed) rather than as a centered modal.
	const [confirmOpen, setConfirmOpen] = useState(false);
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
				className={`group flex h-7 items-center gap-sm rounded-[var(--radius-sm)] pr-xs pl-xl transition-colors ${
					isActive ? "bg-hover" : "hover:bg-hover"
				}`}
			>
				<button
					type="button"
					onClick={onSelect}
					className="flex min-w-0 flex-1 items-center gap-sm text-left"
				>
					<GitBranch className={`size-4 shrink-0 ${isActive ? "text-primary" : "text-hint"}`} />
					<span
						data-testid="workspace-name"
						className={`truncate text-sm ${isActive ? "font-medium text-primary" : "text-muted"}`}
					>
						{workspace.name}
					</span>
				</button>
				{hasStats && (
					<span className="shrink-0 text-xs tabular-nums group-hover:hidden">
						<span className="text-green">+{stats.added}</span>{" "}
						<span className="text-red">−{stats.removed}</span>
					</span>
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
	);
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
	return (
		<div className="flex flex-col items-start gap-sm rounded-[var(--radius-md)] border border-border2 border-dashed p-md">
			<p className="text-sm text-muted">No projects open.</p>
			<p className="text-xs text-hint">Open a git repository to get started.</p>
			<Button variant="outline" size="sm" onClick={onOpen}>
				<Folder className="size-4" />
				Open project
			</Button>
		</div>
	);
}
