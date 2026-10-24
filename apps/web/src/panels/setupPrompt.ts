import { t } from "@thinkrail/locales/react";

export const SETUP_PROMPT = "/skill:setting-up-a-project ";

export type WorkspaceDialogRequest = { projectId: string; prompt: string; note?: string };

export function setupDialogRequest(projectId: string): WorkspaceDialogRequest {
	return { projectId, prompt: SETUP_PROMPT, note: t("panels.welcome.setupNote") };
}
