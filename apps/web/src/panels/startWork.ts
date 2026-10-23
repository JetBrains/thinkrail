import type { ThinkingLevel, WireModel, Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import type { ChatAttachment } from "@/chat/types";
import { toast, useAppStore } from "@/store";
import { createSessionWithSkillBaseline, errorText, getTransport } from "@/transport";
import { enterDefaultWorkspace } from "./defaultWorkspace";
import { promptWorkspaceChat } from "./openChat";

export type StartWorkTarget =
	| { readonly kind: "workspace"; readonly projectId: string; readonly baseRef?: string }
	| { readonly kind: "project-folder"; readonly projectId: string }
	| { readonly kind: "current-chat"; readonly workspaceId: string; readonly sessionId: string };

export interface StartWorkPrompt {
	readonly text: string;
	readonly images?: readonly ChatAttachment[];
	readonly model?: { readonly model: WireModel; readonly thinkingLevel: ThinkingLevel };
}

async function refreshProjectWorkspaces(projectId: string): Promise<void> {
	useAppStore.getState().expandProject(projectId);
	const rows = await getTransport().request("workspace.list", { projectId });
	useAppStore.getState().setWorkspaces(projectId, rows);
}

/** Resolves the workspace a start targets — creating the worktree when asked — and makes it active. */
export async function prepareStartWorkspace(
	target: Exclude<StartWorkTarget, { kind: "current-chat" }>,
): Promise<Workspace | null> {
	if (target.kind === "project-folder") return enterDefaultWorkspace(target.projectId);
	useAppStore.getState().beginWorktreeCreation(target.projectId);
	let workspace: Workspace;
	try {
		const baseRef =
			target.baseRef ||
			(await getTransport().request("git.listBranches", { projectId: target.projectId }))
				.defaultBranch;
		workspace = await getTransport().request("workspace.create", {
			projectId: target.projectId,
			...(baseRef ? { baseRef } : {}),
		});
	} catch (err) {
		toast.error(errorText(err), t("panels.newWorkspace.createFailed"));
		return null;
	} finally {
		useAppStore.getState().endWorktreeCreation(target.projectId);
	}
	void refreshProjectWorkspaces(workspace.projectId).catch(() => {});
	useAppStore.getState().activateWorkspace(workspace);
	return workspace;
}

/** Opens a fresh chat in the workspace and sends the prompt as its first turn (nothing is sent for an empty prompt). */
export async function startChatIn(workspace: Workspace, prompt: StartWorkPrompt): Promise<void> {
	const store = useAppStore.getState();
	const attachments = prompt.images ?? [];
	store.beginChatStart(workspace.id);
	try {
		const { result: session, syncedTick } = await createSessionWithSkillBaseline({
			workspaceId: workspace.id,
			...(prompt.model ? prompt.model : {}),
		});
		store.openChatSession(
			workspace.id,
			session.sessionId,
			session.model,
			session.thinkingLevel,
			syncedTick,
		);
		if (!prompt.text && attachments.length === 0) return;
		store.appendUserMessage(
			session.sessionId,
			prompt.text,
			attachments.length > 0 ? [...attachments] : undefined,
		);
		getTransport()
			.request("session.prompt", {
				sessionId: session.sessionId,
				text: prompt.text,
				...(attachments.length > 0 ? { images: attachments.map((a) => a.content) } : {}),
			})
			.catch((err) => store.appendErrorTurn(session.sessionId, errorText(err)));
	} catch (err) {
		toast.error(errorText(err), t("panels.newWorkspace.chatStartFailed"));
	} finally {
		useAppStore.getState().endChatStart(workspace.id);
	}
}

/** The palette's one-shot start: resolve the target, then hand the text to a new or the current chat. */
export async function startWork(target: StartWorkTarget, prompt: StartWorkPrompt): Promise<void> {
	if (target.kind === "current-chat") {
		await promptWorkspaceChat(target.workspaceId, target.sessionId, prompt.text);
		return;
	}
	const workspace = await prepareStartWorkspace(target);
	if (workspace) await startChatIn(workspace, prompt);
}
