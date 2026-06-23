import type { Project, Workspace } from "@thinkrail-pi/contracts";
import {
	Archive,
	ChevronDown,
	ChevronRight,
	Folder,
	GitBranch,
	Globe,
	Loader2,
	Plus,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "../store/appStore";
import { getTransport } from "../wireTransport";

/** Left-nav: projects → workspaces (git worktrees). Open a repo, select it, create/select workspaces. */
export function ProjectTree() {
	const projects = useAppStore((s) => s.projects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const workspaces = useAppStore((s) => s.workspaces);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);

	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [dialogOpen, setDialogOpen] = useState(false);
	const [path, setPath] = useState("");
	const [opening, setOpening] = useState(false);
	const [creatingFor, setCreatingFor] = useState<string | null>(null);

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

	const openProject = async (rawPath: string) => {
		const trimmed = rawPath.trim();
		if (!trimmed) return;
		setOpening(true);
		try {
			const project = await getTransport().request("project.open", { path: trimmed });
			useAppStore.getState().setProjects(await getTransport().request("project.list", {}));
			setPath("");
			setDialogOpen(false);
			await selectProject(project.id);
		} catch {
			// Error surfacing (toast) comes with the error-handling pass; ignore for now.
		} finally {
			setOpening(false);
		}
	};

	const addWorkspace = async (projectId: string) => {
		setCreatingFor(projectId);
		try {
			const workspace = await getTransport().request("workspace.create", { projectId });
			setExpanded((prev) => new Set(prev).add(projectId));
			await loadWorkspaces(projectId);
			useAppStore.getState().setActiveWorkspace(workspace.id);
		} catch {
			// Ignored until the error-handling pass.
		} finally {
			setCreatingFor(null);
		}
	};

	const archiveWorkspace = async (projectId: string, workspaceId: string) => {
		try {
			await getTransport().request("workspace.remove", { id: workspaceId });
			if (activeWorkspaceId === workspaceId) useAppStore.getState().setActiveWorkspace("");
			await loadWorkspaces(projectId);
		} catch {
			// Ignored until the error-handling pass.
		}
	};

	return (
		<nav className="flex flex-col gap-sm">
			<header className="flex h-7 items-center justify-between pr-xs pl-sm">
				<span className="text-xs uppercase tracking-wider text-muted">Projects</span>
				<AddProjectMenu
					projects={projects}
					onOpenDialog={() => setDialogOpen(true)}
					onOpenRecent={(p) => void openProject(p)}
				/>
			</header>

			{projects.length === 0 ? (
				<EmptyState onOpen={() => setDialogOpen(true)} />
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
									isCreating={creatingFor === project.id}
									onToggle={() => toggleExpand(project.id)}
									onSelect={() => void selectProject(project.id)}
									onAddWorkspace={() => void addWorkspace(project.id)}
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
													onArchive={() => void archiveWorkspace(project.id, ws.id)}
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

			<OpenProjectDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				path={path}
				onPathChange={setPath}
				opening={opening}
				onSubmit={() => void openProject(path)}
			/>
		</nav>
	);
}

function AddProjectMenu({
	projects,
	onOpenDialog,
	onOpenRecent,
}: {
	projects: Project[];
	onOpenDialog: () => void;
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
				<DropdownMenuItem data-testid="menu-open-project" onSelect={onOpenDialog}>
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
	isCreating,
	onToggle,
	onSelect,
	onAddWorkspace,
}: {
	project: Project;
	isSelected: boolean;
	isExpanded: boolean;
	workspaceCount: number;
	isCreating: boolean;
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
				disabled={isCreating}
				onClick={onAddWorkspace}
				className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted opacity-0 transition hover:bg-elevated hover:text-text group-hover:opacity-100 disabled:opacity-50"
			>
				{isCreating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
			</button>
		</div>
	);
}

function WorkspaceRow({
	workspace,
	isActive,
	onSelect,
	onArchive,
}: {
	workspace: Workspace;
	isActive: boolean;
	onSelect: () => void;
	onArchive: () => void;
}) {
	const stats = workspace.diffStats;
	const hasStats = stats != null && (stats.added > 0 || stats.removed > 0);
	return (
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
			<button
				type="button"
				data-testid="workspace-archive"
				aria-label="Archive workspace"
				onClick={onArchive}
				className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-muted opacity-0 transition hover:bg-elevated hover:text-red group-hover:opacity-100"
			>
				<Archive className="size-4" />
			</button>
		</div>
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

function OpenProjectDialog({
	open,
	onOpenChange,
	path,
	onPathChange,
	opening,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	path: string;
	onPathChange: (value: string) => void;
	opening: boolean;
	onSubmit: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent data-testid="open-project-dialog">
				<DialogHeader>
					<DialogTitle>Open project</DialogTitle>
				</DialogHeader>
				<form
					className="flex flex-col gap-sm"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmit();
					}}
				>
					<label htmlFor="open-project-path" className="text-xs text-muted">
						Repository path
					</label>
					<input
						id="open-project-path"
						data-testid="add-project-input"
						value={path}
						onChange={(event) => onPathChange(event.target.value)}
						placeholder="/path/to/git/repo"
						className="w-full rounded-[var(--radius-sm)] border border-border2 bg-bg-dark px-sm py-xs text-sm text-text outline-none placeholder:text-hint focus-visible:ring-2 focus-visible:ring-primary"
					/>
					<DialogFooter>
						<Button
							type="submit"
							data-testid="add-project-submit"
							disabled={opening || !path.trim()}
						>
							{opening ? <Loader2 className="size-4 animate-spin" /> : null}
							Open
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
