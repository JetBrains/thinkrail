import { t } from "@thinkrail/locales/react";
import { enterDefaultWorkspace } from "./defaultWorkspace";
import { startChatInTab } from "./openChat";

export const SETUP_PROMPT = "/skill:setting-up-a-project ";

export type WorkspaceDialogRequest = { projectId: string; prompt: string; note?: string };

export function setupDialogRequest(projectId: string): WorkspaceDialogRequest {
	return { projectId, prompt: SETUP_PROMPT, note: t("panels.welcome.setupNote") };
}

export async function startProjectSetupChat(projectId: string): Promise<void> {
	const workspace = await enterDefaultWorkspace(projectId);
	if (workspace) await startChatInTab(workspace.id, { draft: SETUP_PROMPT });
}
