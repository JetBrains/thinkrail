import { t } from "@thinkrail/locales/react";
import { fileName } from "../lib";
import { selectAttentionCenterTab, toast, useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { mentionText } from "./artifactsModel";

export function selectArtifactMentionTarget(
	state: ReturnType<typeof useAppStore.getState>,
	workspaceId: string,
): string | null {
	const tab = selectAttentionCenterTab(state, workspaceId);
	return tab?.kind === "chat" ? tab.sessionId : null;
}

export function mentionArtifact(workspaceId: string, path: string): void {
	const store = useAppStore.getState();
	const sessionId = selectArtifactMentionTarget(store, workspaceId);
	if (!sessionId) return;
	store.pasteIntoComposer(sessionId, mentionText(path));
	store.requestComposerFocus(workspaceId, sessionId, { dismissHistory: true });
}

export function revealArtifact(workspaceId: string, path: string): void {
	const store = useAppStore.getState();
	store.setFilesMode("all");
	store.revealInFiles(workspaceId, path);
	store.requestToolView(workspaceId, "files");
}

export async function restoreArtifact(workspaceId: string, path: string): Promise<void> {
	try {
		await getTransport().request("artifacts.restore", { workspaceId, path });
	} catch (error) {
		toast.error(
			wsErrorCode(error) === "ENTRY_EXISTS"
				? t("panels.artifacts.restoreTaken", { name: fileName(path) })
				: errorText(error),
			t("panels.artifacts.restoreFailed"),
		);
	}
}

export async function discardArtifact(workspaceId: string, path: string): Promise<void> {
	try {
		await getTransport().request("artifacts.discard", { workspaceId, path });
	} catch (error) {
		toast.error(errorText(error), t("panels.artifacts.discardFailed"));
	}
}
