import type { Project, SessionStateRecord, Workspace } from "@thinkrail/contracts";
import type { WorkspaceLayoutDocument } from "../shell/layout";
import type { ClosedChat } from "./appStore";

export type SessionAttention = "needs-input" | "error" | "unread" | "running";

export interface SwitcherSession {
	sessionId: string;
	workspaceId: string;
	projectId: string;
	workspaceName: string;
	chatTitle: string;
	attention: SessionAttention;
}

export interface SwitcherProject {
	projectId: string;
	projectName: string;
	needsAttention: boolean;
	sessions: SwitcherSession[];
}

interface SwitcherGroupsState {
	projects: Project[];
	workspaces: Record<string, Workspace[]>;
	sessionStateByWorkspace: Record<string, Record<string, SessionStateRecord>>;
	layoutDocumentsByWorkspace: Record<string, WorkspaceLayoutDocument>;
	closedChatsByWorkspace: Record<string, ClosedChat[]>;
}

function getSessionAttention(state: SessionStateRecord["state"]): SessionAttention | null {
	if (state.needsInput !== null) return "needs-input";
	if (state.completionUnread && state.completion?.outcome === "failed") return "error";
	if (state.completionUnread) return "unread";
	if (state.execution === "running") return "running";
	return null;
}

const ATTENTION_PRIORITY: Record<SessionAttention, number> = {
	"needs-input": 0,
	error: 1,
	unread: 2,
	running: 3,
};

function compareSessionsByAttention(a: SwitcherSession, b: SwitcherSession): number {
	return ATTENTION_PRIORITY[a.attention] - ATTENTION_PRIORITY[b.attention];
}

function resolveChatTitle(
	state: SwitcherGroupsState,
	workspaceId: string,
	sessionId: string,
): string | null {
	const document = state.layoutDocumentsByWorkspace[workspaceId];
	if (document) {
		const visit = (node: WorkspaceLayoutDocument["center"]): string | null => {
			if (node.kind === "split") {
				return visit(node.children[0]) ?? visit(node.children[1]);
			}
			for (const tab of node.tabs) {
				if (tab.kind === "chat" && tab.sessionId === sessionId) return tab.name;
			}
			return null;
		};
		const fromLayout = visit(document.center);
		if (fromLayout) return fromLayout;
	}
	const closed = state.closedChatsByWorkspace[workspaceId] ?? [];
	return closed.find((chat) => chat.sessionId === sessionId)?.title ?? null;
}

function resolveWorkspaceName(
	state: SwitcherGroupsState,
	projectId: string,
	workspaceId: string,
): string | null {
	return (
		state.workspaces[projectId]?.find((workspace) => workspace.id === workspaceId)?.name ?? null
	);
}

export function selectSwitcherGroups(state: SwitcherGroupsState): SwitcherProject[] {
	const sessionsByProject = new Map<string, SwitcherSession[]>();
	for (const records of Object.values(state.sessionStateByWorkspace)) {
		for (const record of Object.values(records)) {
			const attention = getSessionAttention(record.state);
			if (!attention) continue;
			const sessions = sessionsByProject.get(record.projectId) ?? [];
			sessions.push({
				sessionId: record.sessionId,
				workspaceId: record.workspaceId,
				projectId: record.projectId,
				workspaceName: resolveWorkspaceName(state, record.projectId, record.workspaceId) ?? "",
				chatTitle: resolveChatTitle(state, record.workspaceId, record.sessionId) ?? "",
				attention,
			});
			sessionsByProject.set(record.projectId, sessions);
		}
	}

	const groups: SwitcherProject[] = [];
	for (const project of state.projects) {
		const sessions = sessionsByProject.get(project.id);
		if (!sessions || sessions.length === 0) continue;
		sessions.sort(compareSessionsByAttention);
		groups.push({
			projectId: project.id,
			projectName: project.name,
			needsAttention: sessions.some((session) => session.attention !== "running"),
			sessions,
		});
	}
	return groups;
}
