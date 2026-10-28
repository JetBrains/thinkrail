import {
	type ChatContinuation,
	CONTINUATION_PROTOCOL_VERSION,
	type ThinkingLevel,
	type WireModel,
	type Workspace,
} from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { useEffect } from "react";
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

export function supportsChatContinuation(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= CONTINUATION_PROTOCOL_VERSION;
}

const initiatedContinuations = new Set<string>();

/**
 * Asks the host to continue a chat in a new workspace of `projectId`; this client remembers the
 * operation so that, alone among clients, it follows the new chat when the host reports `started`.
 */
export async function continueChatInWorkspace(
	workspaceId: string,
	projectId: string,
): Promise<string | null> {
	try {
		const { operationId } = await getTransport().request("chat.continue", {
			workspaceId,
			projectId,
		});
		initiatedContinuations.add(operationId);
		return operationId;
	} catch (err) {
		toast.error(errorText(err), t("panels.chats.continueFailed"));
		return null;
	}
}

/** Called for every `chat.continuation` push: only the initiating client navigates, once, when the new chat exists. */
export function followContinuation(continuation: ChatContinuation): void {
	if (!initiatedContinuations.has(continuation.operationId)) return;
	if (continuation.phase === "failed" || continuation.phase === "lost") {
		initiatedContinuations.delete(continuation.operationId);
		toast.error(
			continuation.reason ?? t("panels.chats.continueFailed"),
			t("panels.chats.continueFailed"),
		);
		return;
	}
	if (continuation.phase !== "started" || !continuation.workspaceId) return;
	initiatedContinuations.delete(continuation.operationId);
	const { workspaceId, projectId, sessionId } = continuation;
	void loadProjectWorkspaces(projectId)
		.catch(() => {})
		.finally(() => {
			useAppStore.getState().activateWorkspaceFromRoute({ id: workspaceId, projectId }, sessionId);
		});
}

/** Mounted once by the shell: every continuation push the store records is offered to `followContinuation`. */
export function useFollowContinuations(): void {
	const continuations = useAppStore((s) => s.chatContinuations);
	useEffect(() => {
		for (const continuation of Object.values(continuations)) followContinuation(continuation);
	}, [continuations]);
}
