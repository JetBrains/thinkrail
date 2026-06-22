import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { getTransport } from "../wireTransport";

/** Left-nav: the list of opened projects + an input to open a git repo as a new project. */
export function ProjectTree() {
	const projects = useAppStore((s) => s.projects);
	const [path, setPath] = useState("");

	const addProject = async () => {
		const trimmed = path.trim();
		if (!trimmed) return;
		try {
			await getTransport().request("project.open", { path: trimmed });
			setPath("");
			useAppStore.getState().setProjects(await getTransport().request("project.list", {}));
		} catch {
			// Error surfacing (toast) comes with the error-handling pass; ignore for now.
		}
	};

	return (
		<div className="flex flex-col gap-sm">
			<div className="text-xs uppercase tracking-wider text-muted">Projects</div>
			<ul className="flex flex-col gap-xs">
				{projects.map((project) => (
					<li key={project.id} data-testid="project-item" className="truncate text-sm text-text">
						{project.name}
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
