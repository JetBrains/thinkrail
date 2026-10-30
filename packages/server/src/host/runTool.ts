import type { RunToolHost } from "../agent";
import { getSessionWorkspaceId } from "../agent";
import { getProjects } from "../projects";
import { getProjectRun, listRunState, readRunOutput, setRecipe, startRun, stopRun } from "../run";
import { getWorkspace } from "../workspaces";

export const runToolHost: RunToolHost = {
	workspaceOf: getSessionWorkspaceId,
	context: (workspaceId) => {
		const workspace = getWorkspace(workspaceId);
		const project = getProjects().find((candidate) => candidate.id === workspace.projectId);
		if (!project) throw new Error(`Unknown project: ${workspace.projectId}`);
		return {
			projectId: project.id,
			workspaceId,
			workspaceName: workspace.name,
			isDefaultWorkspace: workspace.kind === "default",
			projectPath: project.path,
			run: getProjectRun(project.id),
			platformSupported: process.platform !== "win32",
		};
	},
	setRecipe: (workspaceId, sessionId, recipe, expectedRevision) =>
		setRecipe(getWorkspace(workspaceId).projectId, recipe, expectedRevision, {
			sessionId,
			workspaceId,
		}),
	start: (workspaceId, targetId, prepare) =>
		startRun(workspaceId, targetId, { origin: "agent", prepare }),
	stop: (workspaceId, targetId) => stopRun(workspaceId, targetId),
	state: listRunState,
	output: readRunOutput,
};
