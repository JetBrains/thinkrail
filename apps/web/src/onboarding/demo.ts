import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";

export async function startDemo(): Promise<void> {
	const store = useAppStore.getState();
	try {
		const project = await getTransport().request("demo.ensure", {});
		store.applyProjectUpdated(project);
		store.startOnboarding(project.id);
		store.selectProject(project.id, { reveal: true });
		const rows = await getTransport().request("workspace.list", { projectId: project.id });
		useAppStore.getState().setWorkspaces(project.id, rows);
	} catch (err) {
		toast.error(errorText(err, "Couldn't start the To Do App demo."));
	}
}

export async function resetDemo(): Promise<void> {
	const demoProjectId = useAppStore.getState().onboarding.demoProjectId;
	try {
		await getTransport().request("demo.reset", {});
	} catch (err) {
		toast.error(errorText(err, "Couldn't reset the demo."));
		return;
	}
	try {
		const open = await getTransport().request("project.list", {});
		const recent = useAppStore
			.getState()
			.recentProjects.filter((project) => project.id !== demoProjectId);
		useAppStore.getState().installProjectSnapshot(open, recent);
	} catch {}
	useAppStore.getState().resetOnboarding();
}
