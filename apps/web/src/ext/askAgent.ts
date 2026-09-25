import { toast, useAppStore } from "../store";
import { createSessionWithSkillBaseline, errorText } from "../transport";

export const fixPrompt = ({
	name,
	surfaceId,
	error,
}: {
	name: string;
	surfaceId?: string;
	error: string;
}) =>
	[
		`The ThinkRail UI extension "${name}"${surfaceId ? ` (surface "${surfaceId}")` : ""} is failing:`,
		"",
		error,
		"",
		`Run ext_logs("${name}") to read its logs, fix the code, then run ext_reload("${name}").`,
	].join("\n");

export const askAgentToFix = async (text: string) => {
	const workspaceId = useAppStore.getState().activeWorkspaceId;
	if (!workspaceId) {
		toast.error("Open a workspace first.", "Couldn't start the chat");
		return;
	}
	try {
		const {
			result: { sessionId, model, thinkingLevel },
			syncedTick,
		} = await createSessionWithSkillBaseline({ workspaceId });
		const store = useAppStore.getState();
		store.openChatSession(workspaceId, sessionId, model, thinkingLevel, syncedTick);
		store.setChatDraft(sessionId, text);
	} catch (error) {
		toast.error(errorText(error), "Couldn't start the chat");
	}
};
