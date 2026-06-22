import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { getTransport } from "../wireTransport";

/** Left-nav: projects → workspaces (git worktrees). Open a repo, select it, create/select workspaces. */
export function ProjectTree() {
	const projects = useAppStore((s) => s.projects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const workspaces = useAppStore((s) => s.workspaces);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const [path, setPath] = useState("");

	const loadWorkspaces = async (projectId: string) => {
		useAppStore
			.getState()
			.setWorkspaces(projectId, await getTransport().request("workspace.list", { projectId }));
	};

	const selectProject = async (projectId: string) => {
		useAppStore.getState().selectProject(projectId);
		await loadWorkspaces(projectId);
	};

	const addProject = async () => {
		const trimmed = path.trim();
		if (!trimmed) return;
		try {
			const project = await getTransport().request("project.open", { path: trimmed });
			setPath("");
			useAppStore.getState().setProjects(await getTransport().request("project.list", {}));
			await selectProject(project.id);
		} catch {
			// Error surfacing (toast) comes with the error-handling pass; ignore for now.
		}
	};

	const addWorkspace = async (projectId: string) => {
		const workspace = await getTransport().request("workspace.create", { projectId });
		await loadWorkspaces(projectId);
		useAppStore.getState().setActiveWorkspace(workspace.id);
	};

	return (
		<div className="flex flex-col gap-sm">
			<div className="text-xs uppercase tracking-wider text-muted">Projects</div>
			<ul className="flex flex-col gap-xs">
				{projects.map((project) => (
					<li key={project.id} className="flex flex-col gap-xs">
						<button
							type="button"
							data-testid="project-item"
							onClick={() => selectProject(project.id)}
							className={`truncate text-left text-sm ${selectedProjectId === project.id ? "text-text" : "text-muted"}`}
						>
							{project.name}
						</button>
						{selectedProjectId === project.id && (
							<div className="flex flex-col gap-xs pl-sm">
								{(workspaces[project.id] ?? []).map((ws) => (
									<button
										key={ws.id}
										type="button"
										data-testid="workspace-item"
										onClick={() => useAppStore.getState().setActiveWorkspace(ws.id)}
										className={`flex items-center justify-between gap-sm text-left text-sm ${activeWorkspaceId === ws.id ? "text-primary" : "text-muted"}`}
									>
										<span className="truncate">{ws.name}</span>
										{ws.diffStats && (ws.diffStats.added > 0 || ws.diffStats.removed > 0) && (
											<span className="shrink-0 text-xs">
												<span className="text-green">+{ws.diffStats.added}</span>{" "}
												<span className="text-red">−{ws.diffStats.removed}</span>
											</span>
										)}
									</button>
								))}
								<button
									type="button"
									data-testid="add-workspace"
									onClick={() => addWorkspace(project.id)}
									className="text-left text-xs text-hint hover:text-text"
								>
									+ workspace
								</button>
							</div>
						)}
					</li>
				))}
			</ul>
			<div className="flex gap-xs">
				<input
					data-testid="add-project-input"
					value={path}
					onChange={(event) => setPath(event.target.value)}
					placeholder="git repo path"
					className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-border2 bg-[var(--bg-input)] px-sm py-xs text-sm text-text"
				/>
				<button
					type="button"
					data-testid="add-project-submit"
					onClick={addProject}
					className="rounded-[var(--radius-sm)] bg-primary px-sm py-xs text-sm text-on-accent"
				>
					Add
				</button>
			</div>
		</div>
	);
}
