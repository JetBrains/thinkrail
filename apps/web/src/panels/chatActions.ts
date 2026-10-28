import type { ThinkingLevel, WireModel, Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import type { ChatAttachment } from "../chat/types";
import { selectWorkspaceTick, supportsProjectlessChats, toast, useAppStore } from "../store";
import { errorText, getTransport, prewarmWorkspaceSkillLoad } from "../transport";
import { loadProjectWorkspaces } from "./workspaceActions";

export interface ProjectlessChatStart {
	readonly text?: string;
	readonly images?: readonly ChatAttachment[];
	readonly model?: { readonly model: WireModel; readonly thinkingLevel: ThinkingLevel };
}

/** The host of this protocol holds chats without a project, in the built-in container it ensures at boot. */
export function canStartProjectlessChat(state: { protocolVersion: number | null }): boolean {
	return supportsProjectlessChats(state.protocolVersion);
}

let starting: Promise<Workspace | null> | null = null;

/** `chat.create` makes the folder, the record and the one session; this makes it the active chat and sends the first prompt. A start already in flight is joined, so a double click makes one chat. */
export function startProjectlessChat(start: ProjectlessChatStart = {}): Promise<Workspace | null> {
	starting ??= runProjectlessChatStart(start).finally(() => {
		starting = null;
	});
	return starting;
}

async function runProjectlessChatStart(start: ProjectlessChatStart): Promise<Workspace | null> {
	if (!canStartProjectlessChat(useAppStore.getState())) return null;
	let created: Awaited<ReturnType<typeof requestChatCreate>>;
	try {
		created = await requestChatCreate(start);
	} catch (err) {
		toast.error(errorText(err), t("panels.chats.createFailed"));
		return null;
	}
	const { workspace } = created;
	const next = useAppStore.getState();
	if (next.onboardingWizard !== "hidden") next.setOnboardingWizard("hidden");
	next.expandProject(workspace.projectId);
	const listed = next.workspaces[workspace.projectId];
	if (listed) {
		next.setWorkspaces(workspace.projectId, [
			workspace,
			...listed.filter((candidate) => candidate.id !== workspace.id),
		]);
	} else {
		await loadProjectWorkspaces(workspace.projectId).catch(() => {
			useAppStore.getState().setWorkspaces(workspace.projectId, [workspace]);
		});
	}
	next.activateWorkspace(workspace);
	next.openChatSession(
		workspace.id,
		created.sessionId,
		created.model,
		created.thinkingLevel,
		selectWorkspaceTick(next, workspace.id),
	);
	void prewarmWorkspaceSkillLoad(workspace.id).catch(() => {});
	const text = start.text?.trim() ?? "";
	const attachments = start.images ?? [];
	if (text || attachments.length > 0) {
		next.appendUserMessage(
			created.sessionId,
			text,
			attachments.length > 0 ? [...attachments] : undefined,
		);
		getTransport()
			.request("session.prompt", {
				sessionId: created.sessionId,
				text,
				...(attachments.length > 0 ? { images: attachments.map((a) => a.content) } : {}),
			})
			.catch((err) => useAppStore.getState().appendErrorTurn(created.sessionId, errorText(err)));
	}
	return workspace;
}

function requestChatCreate(start: ProjectlessChatStart) {
	return getTransport().request("chat.create", start.model ? { ...start.model } : {});
}

/** The only teardown: the host trashes the transcripts and the folder, then publishes the removal. */
export async function deleteProjectlessChat(workspaceId: string): Promise<boolean> {
	try {
		await getTransport().request("chat.delete", { workspaceId });
		return true;
	} catch (err) {
		toast.error(errorText(err), t("panels.chats.deleteFailed"));
		return false;
	}
}

export async function inspectProjectlessChat(
	workspaceId: string,
): Promise<{ files: number; truncated: boolean } | null> {
	try {
		return await getTransport().request("chat.inspect", { workspaceId });
	} catch {
		return null;
	}
}
