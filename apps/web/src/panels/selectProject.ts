import { useAppStore } from "../store";
import { getTransport } from "../transport";

/**
 * The shared "select a project" orchestration, used by the projects rail's row click and both
 * open-project adopt steps (`ProjectTree`, `WelcomePanel`): refresh the project's workspace list into
 * the store, **then** call `store.selectProject`, whose pick (last-active → newest → Welcome) runs on
 * fresh cache — so the Welcome surface never flashes for a project that turns out to have workspaces.
 * A failed list request degrades to selecting anyway (Welcome on an empty cache) rather than a dead click.
 */
export async function selectProjectWithWorkspaces(projectId: string): Promise<void> {
	const list = await getTransport()
		.request("workspace.list", { projectId })
		.catch(() => null);
	if (list) useAppStore.getState().setWorkspaces(projectId, list);
	useAppStore.getState().selectProject(projectId);
}
