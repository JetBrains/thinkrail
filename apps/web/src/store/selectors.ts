import type {
	GitDiffScope,
	Project,
	SpecGraphNode,
	WireModel,
	Workspace,
} from "@thinkrail/contracts";
import {
	isAbsolutePath,
	type LayoutAttention,
	layoutResourceIdentity,
	normalizePath,
	readLayoutSelection,
} from "../lib";
import type {
	LayoutAuxiliaryRegion,
	LayoutCenterTab,
	LayoutTab,
	WorkspaceLayoutDocument,
} from "../shell/layout";
import type {
	ClosedChat,
	EditorTab,
	RouteChatTarget,
	SessionRuntime,
	TerminalTab,
} from "./appStore";

interface ConnectionGenerationState {
	status: string;
	connectionGeneration: number;
}

export function isConnectedGeneration(
	state: ConnectionGenerationState,
	connectionGeneration: number,
): boolean {
	return state.status === "connected" && state.connectionGeneration === connectionGeneration;
}

interface ActiveWorkspaceState {
	activeWorkspaceId: string | null;
	workspaces: Record<string, Workspace[]>;
}

interface LayoutDocumentState {
	layoutDocumentsByWorkspace: Record<string, WorkspaceLayoutDocument>;
}

interface LayoutAttentionState extends LayoutDocumentState {
	layoutAttentionByWorkspace: Record<string, LayoutAttention>;
}

interface CenterResourceCacheState extends LayoutAttentionState {
	tabsByWorkspace: Record<string, EditorTab[]>;
	terminalsByWorkspace: Record<string, TerminalTab[]>;
}

interface ProjectContextState extends ActiveWorkspaceState {
	selectedProjectId: string | null;
	projects: Project[];
}

export interface LayoutTabPlacement {
	area: "center" | LayoutAuxiliaryRegion;
	groupId: string;
}

export interface LayoutResourcePlacement extends LayoutTabPlacement {
	tabId: string;
	tab: LayoutTab;
}

function findLayoutPlacement(
	document: WorkspaceLayoutDocument,
	matches: (tab: LayoutTab) => boolean,
): LayoutResourcePlacement | null {
	const findCenter = (node: WorkspaceLayoutDocument["center"]): LayoutResourcePlacement | null => {
		if (node.kind === "split") return findCenter(node.children[0]) ?? findCenter(node.children[1]);
		const tab = node.tabs.find(matches);
		return tab ? { area: "center", groupId: node.id, tabId: tab.id, tab } : null;
	};
	const center = findCenter(document.center);
	if (center) return center;
	for (const region of ["left", "right", "bottom"] as const) {
		for (const group of document[region].groups) {
			const tab = group.tabs.find(matches);
			if (tab) return { area: region, groupId: group.id, tabId: tab.id, tab };
		}
	}
	return null;
}

export function selectLayoutTabPlacement(
	state: LayoutDocumentState,
	workspaceId: string,
	tabId: string,
): LayoutTabPlacement | null {
	const document = state.layoutDocumentsByWorkspace[workspaceId];
	if (!document) return null;
	const placement = findLayoutPlacement(document, (tab) => tab.id === tabId);
	return placement ? { area: placement.area, groupId: placement.groupId } : null;
}

export function selectLayoutResourcePlacement(
	state: LayoutDocumentState,
	workspaceId: string,
	resource: LayoutTab,
): LayoutResourcePlacement | null {
	const document = state.layoutDocumentsByWorkspace[workspaceId];
	if (!document) return null;
	const identity = layoutResourceIdentity(resource);
	return findLayoutPlacement(document, (tab) => layoutResourceIdentity(tab) === identity);
}

export function selectLayoutTabPlaced(
	state: LayoutDocumentState,
	workspaceId: string,
	tabId: string,
): boolean {
	return selectLayoutTabPlacement(state, workspaceId, tabId) !== null;
}

export function selectAttentionCenterTab(
	state: LayoutAttentionState,
	workspaceId: string,
): LayoutCenterTab | null {
	const document = state.layoutDocumentsByWorkspace[workspaceId];
	const attention = state.layoutAttentionByWorkspace[workspaceId];
	if (!document || !attention) return null;
	const find = (node: WorkspaceLayoutDocument["center"]): LayoutCenterTab | null => {
		if (node.kind === "split") return find(node.children[0]) ?? find(node.children[1]);
		if (node.id !== attention.lastFocusedCenterGroupId) return null;
		const selectedId = readLayoutSelection(attention, node.id);
		return node.tabs.find((tab) => tab.id === selectedId) ?? node.tabs[0] ?? null;
	};
	return find(document.center);
}

export function selectAttentionCenterResourceCacheKey(
	state: CenterResourceCacheState,
	workspaceId: string,
): string | null {
	const selected = selectAttentionCenterTab(state, workspaceId);
	if (!selected) return null;
	if (selected.kind === "terminal") {
		return (state.terminalsByWorkspace[workspaceId] ?? []).some(
			(terminal) => terminal.tabKey === selected.tabKey,
		)
			? selected.tabKey
			: null;
	}
	const identity = layoutResourceIdentity(selected);
	const cache = (state.tabsByWorkspace[workspaceId] ?? []).find((tab) => {
		switch (tab.kind) {
			case "file":
			case "diff":
			case "chat":
				return tab.kind === selected.kind && layoutResourceIdentity(tab) === identity;
			case "doc":
				return selected.kind === "document" && tab.sourceId === selected.sourceId;
		}
		return false;
	});
	return cache?.id ?? null;
}

export function selectAttentionCenterResourceReady(
	state: CenterResourceCacheState,
	workspaceId: string,
): boolean {
	return selectAttentionCenterResourceCacheKey(state, workspaceId) !== null;
}

export function isDefaultWorkspace(workspace: Pick<Workspace, "kind">): boolean {
	return workspace.kind === "default";
}

export function isExternalWorkspace(workspace: Pick<Workspace, "kind">): boolean {
	return workspace.kind === "external";
}

export function isUserOwnedWorkspace(workspace: Pick<Workspace, "kind">): boolean {
	return isDefaultWorkspace(workspace) || isExternalWorkspace(workspace);
}

export function selectActiveWorkspace(state: ActiveWorkspaceState): Workspace | null {
	return state.activeWorkspaceId ? selectWorkspaceById(state, state.activeWorkspaceId) : null;
}

export function selectWorkspaceById(
	state: ActiveWorkspaceState,
	workspaceId: string,
): Workspace | null {
	for (const workspaces of Object.values(state.workspaces)) {
		const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
		if (workspace) return workspace;
	}
	return null;
}

export function selectActiveWorkspaceProjectId(state: ActiveWorkspaceState): string | null {
	return selectActiveWorkspace(state)?.projectId ?? null;
}

export function selectContextProject(state: ProjectContextState): Project | null {
	const projectId = selectActiveWorkspace(state)?.projectId ?? state.selectedProjectId;
	return state.projects.find((project) => project.id === projectId) ?? null;
}

export interface HistoryTarget {
	workspaceId: string;
	tabId: string;
	sessionId: string;
}

export function selectActiveEditorTab(
	state: {
		tabsByWorkspace: Record<string, EditorTab[]>;
		activeTabByWorkspace: Record<string, string | null>;
	},
	workspaceId: string,
): EditorTab | null {
	const activeId = state.activeTabByWorkspace[workspaceId];
	return (state.tabsByWorkspace[workspaceId] ?? []).find((tab) => tab.id === activeId) ?? null;
}

export function selectHistoryTarget(state: {
	activeWorkspaceId: string | null;
	tabsByWorkspace: Record<string, EditorTab[]>;
	activeTabByWorkspace: Record<string, string | null>;
}): HistoryTarget | null {
	const workspaceId = state.activeWorkspaceId;
	if (!workspaceId) return null;
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	const active = selectActiveEditorTab(state, workspaceId);
	const chat = active?.kind === "chat" ? active : tabs.findLast((t) => t.kind === "chat");
	return chat ? { workspaceId, tabId: chat.id, sessionId: chat.sessionId } : null;
}

export interface KnownChatLocation {
	workspaceId: string;
	title: string;
}

export function selectKnownChatLocation(
	state: {
		tabsByWorkspace: Record<string, EditorTab[]>;
		closedChatsByWorkspace: Record<string, ClosedChat[]>;
	},
	sessionId: string,
): KnownChatLocation | null {
	for (const [workspaceId, tabs] of Object.entries(state.tabsByWorkspace)) {
		const tab = tabs.find(
			(candidate) => candidate.kind === "chat" && candidate.sessionId === sessionId,
		);
		if (tab?.kind === "chat") return { workspaceId, title: tab.name };
	}
	for (const [workspaceId, chats] of Object.entries(state.closedChatsByWorkspace)) {
		const chat = chats.find((candidate) => candidate.sessionId === sessionId);
		if (chat) return { workspaceId, title: chat.title };
	}
	return null;
}

export function selectWorkspaceSessionIds(
	state: {
		tabsByWorkspace: Record<string, EditorTab[]>;
		closedChatsByWorkspace: Record<string, ClosedChat[]>;
		layoutDocumentsByWorkspace?: Record<string, WorkspaceLayoutDocument>;
	},
	workspaceId: string,
): string[] {
	const sessionIds = new Set(
		(state.tabsByWorkspace[workspaceId] ?? []).flatMap((tab) =>
			tab.kind === "chat" || tab.kind === "plan"
				? [tab.sessionId]
				: tab.kind === "doc"
					? [tab.sourceId]
					: [],
		),
	);
	for (const chat of state.closedChatsByWorkspace[workspaceId] ?? []) {
		sessionIds.add(chat.sessionId);
	}
	const visit = (node: WorkspaceLayoutDocument["center"]): void => {
		if (node.kind === "split") {
			visit(node.children[0]);
			visit(node.children[1]);
			return;
		}
		for (const tab of node.tabs) {
			if (tab.kind === "chat") sessionIds.add(tab.sessionId);
			if (tab.kind === "document" && tab.documentKind === "todo-plan") {
				sessionIds.add(tab.sourceId);
			}
		}
	};
	const document = state.layoutDocumentsByWorkspace?.[workspaceId];
	if (document) visit(document.center);
	return [...sessionIds];
}

export function selectCatalogModel(
	models: readonly WireModel[],
	ref: Pick<WireModel, "provider" | "id"> | null,
): WireModel | null {
	if (!ref) return null;
	return models.find((m) => m.provider === ref.provider && m.id === ref.id) ?? null;
}

export const BRANCH_SCOPE: GitDiffScope = { kind: "branch" };

export function selectDiffScope(
	state: { diffScopeByWorkspace: Record<string, GitDiffScope> },
	workspaceId: string,
): GitDiffScope {
	return state.diffScopeByWorkspace[workspaceId] ?? BRANCH_SCOPE;
}

export function selectDiffBaseRef(state: ActiveWorkspaceState, workspaceId: string): string {
	const workspace = selectWorkspaceById(state, workspaceId);
	return workspace ? (workspace.diffBase ?? workspace.baseBranch) : "";
}

export function selectDiffTabTargetRef(
	state: ActiveWorkspaceState,
	tab: { workspaceId: string; scope: GitDiffScope },
): string {
	return tab.scope.kind === "branch" ? selectDiffBaseRef(state, tab.workspaceId) : "";
}

export function matchesWorktreePath(reported: string, rel: string): boolean {
	const path = normalizePath(reported);
	if (path === rel) return true;
	return isAbsolutePath(path) && path.endsWith(`/${rel}`);
}

export function specPathMatcher(nodes: SpecGraphNode[]): (path: string) => boolean {
	const paths = nodes.map((node) => node.path);
	return (reported) => paths.some((rel) => matchesWorktreePath(reported, rel));
}

export function selectChatTitle(
	state: { tabsByWorkspace: Record<string, EditorTab[]> },
	workspaceId: string,
	sessionId: string,
): string {
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	const chatTab = tabs.find((t) => t.kind === "chat" && t.sessionId === sessionId);
	return (chatTab?.name ?? "Chat").trim() || "Chat";
}

export function selectCompactionTurnIds(
	state: { sessions: Record<string, SessionRuntime> },
	sessionId: string,
): ReadonlySet<string> {
	return new Set(
		(state.sessions[sessionId]?.turns ?? [])
			.filter((turn) => turn.kind === "compaction")
			.map((turn) => turn.id),
	);
}

export function selectWorkspaceTick(
	state: { fsChangesByWorkspace: Record<string, { tick: number }> },
	workspaceId: string,
): number {
	return state.fsChangesByWorkspace[workspaceId]?.tick ?? 0;
}

export function selectCurrentRouteChatTarget(state: {
	routeChatTarget: RouteChatTarget | null;
	activeWorkspaceId: string | null;
	navTickByWorkspace: Record<string, number>;
}): RouteChatTarget | null {
	const target = state.routeChatTarget;
	if (!target || state.activeWorkspaceId !== target.workspaceId) return null;
	return selectWorkspaceNavTick(state, target.workspaceId) === target.navTick ? target : null;
}

export function selectWorkspaceNavTick(
	state: { navTickByWorkspace: Record<string, number> },
	workspaceId: string,
): number {
	return state.navTickByWorkspace[workspaceId] ?? 0;
}

interface SkillsStaleState {
	skillChangeTickByWorkspace: Record<string, number>;
	skillsSyncedTickBySession: Record<string, number>;
}

export function selectSkillsStale(
	state: SkillsStaleState,
	workspaceId: string,
	sessionId: string,
): boolean {
	return (
		(state.skillChangeTickByWorkspace[workspaceId] ?? 0) >
		(state.skillsSyncedTickBySession[sessionId] ?? 0)
	);
}

export interface TerminalState {
	activeWorkspaceId: string | null;
	terminalsByWorkspace: Record<string, TerminalTab[]>;
	activeTerminalByWorkspace: Record<string, string | null>;
}

const NO_TERMINALS: TerminalTab[] = [];

export function selectWorkspaceTerminals(state: TerminalState): TerminalTab[] {
	if (!state.activeWorkspaceId) return NO_TERMINALS;
	return state.terminalsByWorkspace[state.activeWorkspaceId] ?? NO_TERMINALS;
}

export function selectActiveTerminalId(state: TerminalState): string | null {
	if (!state.activeWorkspaceId) return null;
	return state.activeTerminalByWorkspace[state.activeWorkspaceId] ?? null;
}

export function selectLastOpenChatSession(
	state: {
		tabsByWorkspace: Record<string, { kind: string; id: string; sessionId?: string }[]>;
		activeTabByWorkspace: Record<string, string | null>;
	},
	workspaceId: string,
): string | null {
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	const activeId = state.activeTabByWorkspace[workspaceId];
	const active = tabs.find((t) => t.id === activeId);
	if (active?.kind === "chat" && active.sessionId) return active.sessionId;
	for (let i = tabs.length - 1; i >= 0; i--) {
		const tab = tabs[i];
		if (tab?.kind === "chat" && tab.sessionId) return tab.sessionId;
	}
	return null;
}

export function selectReviewDraftCount(
	state: { reviewsByWorkspace: Record<string, { comments: { status: string }[] }> },
	workspaceId: string | null,
): number {
	if (!workspaceId) return 0;
	const snapshot = state.reviewsByWorkspace[workspaceId];
	return snapshot ? snapshot.comments.filter((c) => c.status === "draft").length : 0;
}

export function selectAgentReviewCommentCount(
	state: {
		reviewsByWorkspace: Record<string, { comments: { status: string; author?: string }[] }>;
	},
	workspaceId: string | null,
): number {
	if (!workspaceId) return 0;
	const snapshot = state.reviewsByWorkspace[workspaceId];
	if (!snapshot) return 0;
	return snapshot.comments.filter(
		(c) => c.author === "agent" && c.status !== "resolved" && c.status !== "dismissed",
	).length;
}
