import type { Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { useAppStore } from "@/store";
import { startProjectlessChat } from "./chatActions";
import { enterDefaultWorkspace } from "./defaultWorkspace";
import { startChatInTab } from "./openChat";

export const SETUP_PROMPT = "/skill:setting-up-a-project ";
export const CONFIGURE_THINKRAIL_PROMPT = "/skill:configuring-thinkrail";
export const ABOUT_THINKRAIL_PROMPT = "/skill:about-thinkrail";

export type WorkspaceDialogRequest = { projectId: string; prompt: string; note?: string };

export function setupDialogRequest(projectId: string): WorkspaceDialogRequest {
	return { projectId, prompt: SETUP_PROMPT, note: t("panels.welcome.setupNote") };
}

export function startConfigureThinkrailChat(): Promise<Workspace | null> {
	return startProjectlessChat({ text: CONFIGURE_THINKRAIL_PROMPT });
}

export function startAboutThinkrailChat(): Promise<Workspace | null> {
	return startProjectlessChat({ text: ABOUT_THINKRAIL_PROMPT });
}

export async function startProjectSetupChat(projectId: string): Promise<void> {
	const onProjectHome = () => {
		const state = useAppStore.getState();
		return state.selectedProjectId === projectId && state.activeWorkspaceId === null;
	};
	if (!onProjectHome()) return;
	const workspace = await enterDefaultWorkspace(projectId, onProjectHome);
	if (!workspace || useAppStore.getState().activeWorkspaceId !== workspace.id) return;
	await startChatInTab(workspace.id, { draft: SETUP_PROMPT });
}
