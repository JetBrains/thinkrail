import type { Project } from "@thinkrail/contracts";
import { FolderOpen, FolderPlus, GitFork, type LucideIcon } from "lucide-react";
import { useAppStore } from "../store";

export type ProjectActionId = "create" | "open" | "clone";

export interface ProjectActionDef {
	id: ProjectActionId;
	label: string;
	description: string;
	icon: LucideIcon;
}

/**
 * The three project-entry actions — the single frontend source of truth for their label / description /
 * icon / order / id, shared by the Welcome cards and the PROJECTS-rail menu so the copy never drifts.
 * The action itself is uniform: `store.openProjectDialog(id)` opens the matching (mocked) dialog. Keep
 * this small and focused — not a generic action framework.
 */
export const PROJECT_ACTIONS: readonly ProjectActionDef[] = [
	{
		id: "open",
		label: "Open local project",
		description: "Open an existing project folder from this computer.",
		icon: FolderOpen,
	},
	{
		id: "clone",
		label: "Clone from GitHub",
		description: "Clone a GitHub repository into a local folder.",
		icon: GitFork,
	},
	{
		id: "create",
		label: "Create new project",
		description: "Create a new local folder and initialize a git repository.",
		icon: FolderPlus,
	},
];

/** MOCK parent folders the dialogs' "Choose folder" control cycles through (no native picker is called). */
export const MOCK_PARENTS = ["~/code", "~/projects", "~/dev"] as const;
export const DEFAULT_PARENT = MOCK_PARENTS[0];

/** A folder-safe slug from a project name / repo name. */
export function projectSlug(name: string): string {
	return (
		name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "project"
	);
}

/**
 * MOCK landing shared by all three flows: append a `Project` to the client store and select it. That's
 * the existing view-navigation (read-only `ProjectView`, `activeWorkspaceId` stays null, no worktree).
 * No host call — the real flow is a `project.create`/`open`/`clone` wire method (a follow-up).
 */
export function createMockProject(name: string, path: string): void {
	const store = useAppStore.getState();
	const project: Project = {
		id: crypto.randomUUID(),
		name,
		path,
		slug: projectSlug(name),
		lastOpened: Date.now(),
	};
	store.setProjects([...store.projects, project]);
	store.selectProject(project.id);
}
