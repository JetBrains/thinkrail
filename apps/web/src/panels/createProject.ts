import type { Project, Workspace } from "@thinkrail/contracts";
import { toast, useAppStore } from "@/store";
import { createSessionWithSkillBaseline, errorText, getTransport } from "@/transport";

const SETUP_SKILL_PROMPT = "/skill:starting-a-new-project";

export async function createProjectFromScratch(): Promise<Project | null> {
	let project: Project;
	let workspace: Workspace;
	try {
		({ project, workspace } = await getTransport().request("project.create", {}));
	} catch (err) {
		toast.error(errorText(err), "Couldn't create project");
		return null;
	}

	const store = useAppStore.getState();
	store.applyProjectUpdated(project);
	store.setWorkspaces(project.id, [workspace]);
	store.selectProject(project.id, { reveal: true });
	store.activateWorkspace(workspace);

	try {
		const { result: session, syncedTick } = await createSessionWithSkillBaseline({
			workspaceId: workspace.id,
		});
		store.openChatSession(
			workspace.id,
			session.sessionId,
			session.model,
			session.thinkingLevel,
			syncedTick,
		);
		store.appendUserMessage(session.sessionId, SETUP_SKILL_PROMPT);
		getTransport()
			.request("session.prompt", { sessionId: session.sessionId, text: SETUP_SKILL_PROMPT })
			.catch((err) => store.appendErrorTurn(session.sessionId, errorText(err)));
	} catch (err) {
		toast.error(errorText(err), "Couldn't start the setup chat");
	}
	return project;
}
