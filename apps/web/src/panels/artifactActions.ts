import type { WorkspaceArtifact } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { fileName, tupleKey } from "../lib";
import { selectAttentionCenterTab, toast, useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { mentionText } from "./artifactsModel";
import { openFileInTab } from "./openTabs";

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

export async function restoreArtifact(workspaceId: string, path: string): Promise<boolean> {
	try {
		await getTransport().request("artifacts.restore", { workspaceId, path });
		return true;
	} catch (error) {
		toast.error(
			wsErrorCode(error) === "ENTRY_EXISTS"
				? t("panels.artifacts.restoreTaken", { name: fileName(path) })
				: errorText(error),
			t("panels.artifacts.restoreFailed"),
		);
		return false;
	}
}

interface PendingRestore {
	restore: Promise<boolean>;
	deletedAt: number;
}

const pendingRestores = new Map<string, PendingRestore>();

export function restoreDeletedArtifact(
	workspaceId: string,
	artifact: WorkspaceArtifact,
): Promise<boolean> {
	const key = tupleKey("artifact", workspaceId, artifact.path);
	const pending = pendingRestores.get(key);
	if (pending?.deletedAt === artifact.changedAt) return pending.restore;
	const entry: PendingRestore = { restore: Promise.resolve(false), deletedAt: artifact.changedAt };
	entry.restore = restoreArtifact(workspaceId, artifact.path).then((restored) => {
		if (!restored && pendingRestores.get(key) === entry) pendingRestores.delete(key);
		return restored;
	});
	pendingRestores.set(key, entry);
	return entry.restore;
}

export async function openArtifact(
	workspaceId: string,
	artifact: WorkspaceArtifact,
	intent: "preview" | "keep",
): Promise<void> {
	if (artifact.state !== "deleted") return openFileInTab(workspaceId, artifact.path, intent);
	const navigation = useAppStore.getState().beginCenterNavigation(workspaceId);
	if (!(await restoreDeletedArtifact(workspaceId, artifact))) return;
	await openFileInTab(workspaceId, artifact.path, intent, navigation);
}

export async function discardArtifact(workspaceId: string, path: string): Promise<void> {
	try {
		await getTransport().request("artifacts.discard", { workspaceId, path });
	} catch (error) {
		toast.error(errorText(error), t("panels.artifacts.discardFailed"));
	}
}
