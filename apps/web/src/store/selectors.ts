import {
	ANALYTICS_CONSENT_PROTOCOL_VERSION,
	type BackgroundCommandSummary,
	CHAT_RESOURCES_PROTOCOL_VERSION,
	canMarkCompletionUnread,
	DEFAULT_WORKSPACE_NAME,
	type GitDiffScope,
	isSessionWorking,
	MCP_PROTOCOL_VERSION,
	type McpServerResourceSummary,
	MODEL_PICKER_PROTOCOL_VERSION,
	ONBOARDING_PROTOCOL_VERSION,
	PROJECT_TRUST_PROTOCOL_VERSION,
	type Project,
	SESSION_RENAME_PROTOCOL_VERSION,
	SESSION_STATE_PROTOCOL_VERSION,
	type SessionResources,
	type SessionState,
	type SessionStateRecord,
	type SpecGraphNode,
	type SubagentResourceSummary,
	sameModel,
	type WireModel,
	WORKSPACE_READ_STATE_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
	type Workspace,
} from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
import type { LoginState } from "../auth";
import {
	chatName,
	compactAge,
	isAbsolutePath,
	isMcpActiveState,
	isMcpAttentionState,
	type LayoutAttention,
	layoutResourceIdentity,
	normalizePath,
	readLayoutSelection,
	relativeTime,
} from "../lib";
import type {
	LayoutAuxiliaryRegion,
	LayoutCenterTab,
	LayoutTab,
	WorkspaceLayoutDocument,
} from "../shell/layout";
import type {
	ChangesTabSection,
	ClosedChat,
	EditorTab,
	FilesTreeView,
	MarkedUnread,
	PendingMarkUnread,
	RouteChatTarget,
	SessionRuntime,
	TerminalTab,
} from "./appStore";
import type { ChatResourceRead, ChatResourceScope, ChatResourceState } from "./chatResources";

export function selectLoginBusy(state: {
	activeLogin: LoginState | null;
	loginStarting: boolean;
}): boolean {
	return state.loginStarting || state.activeLogin !== null;
}

interface AnalyticsConsentState {
	protocolVersion: number | null;
	welcomeGeneration: number;
	analyticsConsentConfirmed: boolean;
}

export function selectAnalyticsConsentSupported(
	state: Pick<AnalyticsConsentState, "protocolVersion">,
): boolean {
	return (
		state.protocolVersion !== null && state.protocolVersion >= ANALYTICS_CONSENT_PROTOCOL_VERSION
	);
}

export function selectAnalyticsConsentPromptOpen(state: AnalyticsConsentState): boolean {
	return (
		selectAnalyticsConsentSupported(state) &&
		state.welcomeGeneration > 0 &&
		!state.analyticsConsentConfirmed
	);
}

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

interface ProtocolState {
	protocolVersion: number | null;
}

export function selectCanRenameChat(state: ProtocolState): boolean {
	return state.protocolVersion !== null && state.protocolVersion >= SESSION_RENAME_PROTOCOL_VERSION;
}

export function selectSupportsProjectTrust(state: ProtocolState): boolean {
	return state.protocolVersion !== null && state.protocolVersion >= PROJECT_TRUST_PROTOCOL_VERSION;
}

export function selectSupportsOnboarding(state: ProtocolState): boolean {
	return state.protocolVersion !== null && state.protocolVersion >= ONBOARDING_PROTOCOL_VERSION;
}

export function selectOnboardingActive(
	state: ProtocolState & {
		onboardingWizard: "pending" | "shown" | "hidden";
		onboardingDismissed: boolean;
		projects: readonly unknown[];
		recentProjects: readonly unknown[];
	},
): boolean {
	if (state.onboardingDismissed || state.onboardingWizard === "hidden") return false;
	if (state.onboardingWizard === "shown") return true;
	return (
		selectSupportsOnboarding(state) &&
		state.projects.length === 0 &&
		state.recentProjects.length === 0
	);
}

export function selectSupportsMcp(state: ProtocolState): boolean {
	return state.protocolVersion !== null && state.protocolVersion >= MCP_PROTOCOL_VERSION;
}

export function supportsChatResources(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= CHAT_RESOURCES_PROTOCOL_VERSION;
}

/** Whether the host keeps picker favorites/recents and projects picker metadata onto the catalog. */
export function selectSupportsModelPicker(state: ProtocolState): boolean {
	return state.protocolVersion !== null && state.protocolVersion >= MODEL_PICKER_PROTOCOL_VERSION;
}

export function isChatResourceScopeAlive(
	state: ChatResourceState,
	scope: ChatResourceScope,
): boolean {
	return (
		!state.removedWorkspaceIds[scope.workspaceId] &&
		!state.deletedSessionsByWorkspace[scope.workspaceId]?.[scope.sessionId]
	);
}

export function selectChatResourceProjection(state: ChatResourceState, scope: ChatResourceScope) {
	return state.resourceSnapshots[scope.workspaceId]?.[scope.sessionId];
}

export function isChatResourceConnectionCurrent(
	state: ChatResourceState,
	read: ChatResourceScope & { connectionGeneration: number },
): boolean {
	return (
		isChatResourceScopeAlive(state, read) &&
		state.status === "connected" &&
		supportsChatResources(state.protocolVersion) &&
		state.connectionGeneration === read.connectionGeneration
	);
}

export function isChatResourceReadCurrent(
	state: ChatResourceState,
	read: ChatResourceRead,
): boolean {
	return (
		isChatResourceConnectionCurrent(state, read) &&
		selectChatResourceProjection(state, read)?.revision === read.revision
	);
}

export function selectChatResourceAuthority(
	state: ChatResourceState,
	scope: ChatResourceScope,
): boolean {
	const projection = selectChatResourceProjection(state, scope);
	return (
		!!projection?.fresh &&
		projection.connectionGeneration === state.connectionGeneration &&
		state.status === "connected" &&
		supportsChatResources(state.protocolVersion) &&
		isChatResourceScopeAlive(state, scope)
	);
}

export function selectChatResourcesVisible(
	state: ChatResourceState,
	scope: ChatResourceScope,
): boolean {
	return (
		isChatResourceScopeAlive(state, scope) &&
		(supportsChatResources(state.protocolVersion) ||
			(state.protocolVersion === null && !!selectChatResourceProjection(state, scope)))
	);
}

export function selectChatResourcesLoading(
	state: ChatResourceState,
	scope: ChatResourceScope,
): boolean {
	const projection = selectChatResourceProjection(state, scope);
	return (
		!projection?.snapshot &&
		!projection?.error &&
		state.status === "connected" &&
		supportsChatResources(state.protocolVersion)
	);
}

export function selectChatResourcesStale(
	state: ChatResourceState,
	scope: ChatResourceScope,
): boolean {
	const projection = selectChatResourceProjection(state, scope);
	return (
		!selectChatResourceAuthority(state, scope) &&
		(!!projection?.snapshot ||
			!!projection?.error ||
			state.status !== "connected" ||
			!supportsChatResources(state.protocolVersion))
	);
}

export function isActiveBackgroundCommand(command: BackgroundCommandSummary): boolean {
	return command.status === "running" || command.status === "stopping";
}

export function isActiveSubagent(child: SubagentResourceSummary): boolean {
	return child.status === "queued" || child.status === "running";
}

export function orderMcpResources(
	servers: readonly McpServerResourceSummary[],
): McpServerResourceSummary[] {
	return servers
		.slice()
		.sort(
			(a, b) =>
				Number(isMcpAttentionState(b.state)) - Number(isMcpAttentionState(a.state)) ||
				a.name.localeCompare(b.name),
		);
}

export function selectChatResourceGroups(
	snapshot: SessionResources | null | undefined,
	includeMcp = true,
) {
	const commands: BackgroundCommandSummary[] = [];
	const subagents: SubagentResourceSummary[] = [];
	const finishedCommands: BackgroundCommandSummary[] = [];
	const finishedSubagents: SubagentResourceSummary[] = [];
	for (const command of snapshot?.commands ?? []) {
		(isActiveBackgroundCommand(command) ? commands : finishedCommands).push(command);
	}
	for (const child of snapshot?.subagents ?? []) {
		(isActiveSubagent(child) ? subagents : finishedSubagents).push(child);
	}
	const mcpServers =
		includeMcp && snapshot?.mcpServers ? orderMcpResources(snapshot.mcpServers) : null;
	return {
		commands,
		subagents,
		finishedCommands,
		finishedSubagents,
		activeCount: commands.length + subagents.length,
		mcpServers,
		mcpActiveCount: mcpServers?.filter((server) => isMcpActiveState(server.state)).length ?? 0,
		mcpAttentionCount:
			mcpServers?.filter((server) => isMcpAttentionState(server.state)).length ?? 0,
	};
}

export function selectHasNormalizedSessionState(state: ProtocolState): boolean {
	return state.protocolVersion !== null && state.protocolVersion >= SESSION_STATE_PROTOCOL_VERSION;
}

interface SessionStateProjection {
	sessionStateByWorkspace: Record<string, Record<string, SessionStateRecord>>;
}

export function selectSessionState(
	state: SessionStateProjection,
	workspaceId: string,
	sessionId: string,
): SessionState | null {
	return state.sessionStateByWorkspace[workspaceId]?.[sessionId]?.state ?? null;
}

export type WorkspaceOrder = "created" | "recent";

export function supportsWorkspaceSettling(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= WORKSPACE_SETTLE_PROTOCOL_VERSION;
}

export const SETTLED_SHELF_PAGE = 10;
export const SETTLED_SHELF_MORE = 25;
const DAY_MS = 24 * 60 * 60_000;

export type SettledReason =
	| { kind: "override"; since?: number }
	| { kind: "review"; state: "merged" | "closed" }
	| { kind: "idle"; since: number };

/** Chip text; `settledReasonTitle` is the long form. */
export function settledReasonLabel(t: Translator, reason: SettledReason, now: number): string {
	switch (reason.kind) {
		case "override":
			return t("store.settled.byYou");
		case "review":
			return reason.state === "merged" ? t("store.settled.merged") : t("store.settled.closed");
		case "idle":
			return t("store.settled.idle", { age: compactAge(t, reason.since, now) });
	}
}

export function settledReasonTitle(t: Translator, reason: SettledReason, now: number): string {
	switch (reason.kind) {
		case "override":
			return reason.since === undefined
				? t("store.settled.byYouTitle")
				: t("store.settled.byYouTitleAt", { time: relativeTime(t, reason.since, now) });
		case "review":
			return reason.state === "merged"
				? t("store.settled.prMergedTitle")
				: t("store.settled.prClosedTitle");
		case "idle":
			return t("store.settled.idleTitle", { age: compactAge(t, reason.since, now) });
	}
}

export interface SettledRow {
	workspace: Workspace;
	reason: SettledReason;
}

export interface WorkspacePartition {
	live: Workspace[];
	settled: SettledRow[];
}

interface PartitionState extends SessionStateProjection {
	workspaceSettlingSupported: boolean;
	activeWorkspaceId: string | null;
	activeWorkspaceLiveLatch: boolean;
	settleIdleDays: number | null;
}

/** Why a workspace sits on its project's Settled shelf, or `null` while it is live. */
export function selectWorkspaceSettledReason(
	state: PartitionState,
	workspace: Workspace,
	now: number,
): SettledReason | null {
	if (!state.workspaceSettlingSupported || isDefaultWorkspace(workspace)) return null;
	if (
		selectWorkspaceIsRunning(state, workspace.id) ||
		selectWorkspaceNeedsAttention(state, workspace.id)
	) {
		return null;
	}
	if (workspace.settledOverride === "settled") {
		return workspace.settledAt === undefined
			? { kind: "override" }
			: { kind: "override", since: workspace.settledAt };
	}
	if (workspace.settledOverride === "active") return null;
	if (state.activeWorkspaceId === workspace.id && state.activeWorkspaceLiveLatch) return null;
	const review = workspace.review;
	if (review?.state === "merged" || review?.state === "closed") {
		if (review.changedAt === undefined) return null;
		const workedSince =
			workspace.lastActiveAt !== undefined && workspace.lastActiveAt > review.changedAt;
		if (!workedSince) return { kind: "review", state: review.state };
	} else if (review && (review.state === undefined || review.state === "open")) {
		return null;
	}
	if (state.settleIdleDays === null || workspace.lastActiveAt === undefined) return null;
	if (now - workspace.lastActiveAt > state.settleIdleDays * DAY_MS) {
		return { kind: "idle", since: workspace.lastActiveAt };
	}
	return null;
}

/** The Default row stays first; every other row splits into live and settled, newest created first or by `order`. */
export function selectWorkspacePartition(
	state: PartitionState & { workspaces: Record<string, Workspace[]> },
	projectId: string,
	now: number,
	order: WorkspaceOrder = "created",
): WorkspacePartition {
	const rows = state.workspaces[projectId] ?? [];
	if (!state.workspaceSettlingSupported) return { live: rows, settled: [] };
	const live: Workspace[] = [];
	const settled: SettledRow[] = [];
	for (const workspace of rows.toReversed()) {
		if (isDefaultWorkspace(workspace)) continue;
		const reason = selectWorkspaceSettledReason(state, workspace, now);
		if (reason) settled.push({ workspace, reason });
		else live.push(workspace);
	}
	if (order === "recent") {
		const byRecent = (a: Workspace, b: Workspace) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
		live.sort(byRecent);
		settled.sort((a, b) => byRecent(a.workspace, b.workspace));
	}
	const defaults = rows.filter(isDefaultWorkspace);
	return { live: [...defaults, ...live], settled };
}

/** Per loaded project, the rows the shelf took on its own (PR merged/closed or idle), never ones parked by hand. */
export function selectAutoSettledCounts(
	state: PartitionState & { workspaces: Record<string, Workspace[]> },
	now: number,
): { projectId: string; count: number }[] {
	const counts: { projectId: string; count: number }[] = [];
	for (const [projectId, rows] of Object.entries(state.workspaces)) {
		const count = rows.filter((workspace) => {
			const reason = selectWorkspaceSettledReason(state, workspace, now);
			return reason !== null && reason.kind !== "override";
		}).length;
		if (count > 0) counts.push({ projectId, count });
	}
	return counts;
}

export function selectWorkspaceNeedsAttention(
	state: SessionStateProjection,
	workspaceId: string,
): boolean {
	return Object.values(state.sessionStateByWorkspace[workspaceId] ?? {}).some(
		(record) => record.state.needsInput !== null || record.state.completionUnread,
	);
}

export function supportsWorkspaceReadState(protocolVersion: number | null): boolean {
	return protocolVersion !== null && protocolVersion >= WORKSPACE_READ_STATE_PROTOCOL_VERSION;
}

export type WorkspaceReadAction = "markRead" | "markUnread";

export function selectWorkspaceReadAction(
	state: SessionStateProjection,
	workspaceId: string,
): WorkspaceReadAction | null {
	const records = Object.values(state.sessionStateByWorkspace[workspaceId] ?? {});
	if (records.some((record) => record.state.completionUnread)) return "markRead";
	if (records.some((record) => canMarkCompletionUnread(record.state))) return "markUnread";
	return null;
}

interface MarkedUnreadState {
	markingUnreadWorkspaces: Record<string, PendingMarkUnread>;
	markedUnreadBySession: Record<string, MarkedUnread>;
}

export function selectCompletionMarkedUnread(
	state: MarkedUnreadState,
	record: SessionStateRecord,
	options: { heldOnly?: boolean } = {},
): boolean {
	if (!record.state.completionUnread || !record.state.completion) return false;
	const completionId = record.state.completion.completionId;
	const pending = state.markingUnreadWorkspaces[record.workspaceId];
	if (pending?.candidates[record.sessionId] === completionId) return true;
	const mark = state.markedUnreadBySession[record.sessionId];
	return (
		mark !== undefined && mark.completionId === completionId && (!options.heldOnly || mark.held)
	);
}

export function selectWorkspaceIsRunning(
	state: SessionStateProjection,
	workspaceId: string,
): boolean {
	return Object.values(state.sessionStateByWorkspace[workspaceId] ?? {}).some((record) =>
		isSessionWorking(record.state),
	);
}

export function selectProjectNeedsAttention(
	state: SessionStateProjection,
	projectId: string,
): boolean {
	return Object.values(state.sessionStateByWorkspace).some((records) =>
		Object.values(records).some(
			(record) =>
				record.projectId === projectId &&
				(record.state.needsInput !== null || record.state.completionUnread),
		),
	);
}

export function selectProjectIsRunning(state: SessionStateProjection, projectId: string): boolean {
	return Object.values(state.sessionStateByWorkspace).some((records) =>
		Object.values(records).some(
			(record) => record.projectId === projectId && isSessionWorking(record.state),
		),
	);
}

interface CompletionAckState extends SessionStateProjection, MarkedUnreadState {
	status: string;
	connectionGeneration: number;
	sessions: Record<string, SessionRuntime>;
	renderedCompletionBySession: Record<string, string>;
}

export function selectReadyCompletionAck(
	state: CompletionAckState,
	workspaceId: string,
	sessionId: string,
): string | null {
	const record = state.sessionStateByWorkspace[workspaceId]?.[sessionId];
	const completion = record?.state.completion;
	const runtime = state.sessions[sessionId];
	if (
		state.status !== "connected" ||
		!completion ||
		!record.state.completionUnread ||
		!runtime ||
		runtime.syncedConnectionGeneration !== state.connectionGeneration ||
		runtime.hostState?.completion?.completionId !== completion.completionId ||
		state.renderedCompletionBySession[sessionId] !== completion.completionId ||
		selectCompletionMarkedUnread(state, record, { heldOnly: true })
	) {
		return null;
	}
	return completion.completionId;
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

interface ChatAttentionState extends LayoutAttentionState {
	activeWorkspaceId: string | null;
	obscuredChatSessions: Record<string, true>;
	historyOpenRequest: { sessionId: string } | null;
}

export function selectChatAttended(
	state: ChatAttentionState,
	workspaceId: string,
	sessionId: string,
): boolean {
	if (
		state.activeWorkspaceId !== workspaceId ||
		state.obscuredChatSessions[sessionId] ||
		state.historyOpenRequest?.sessionId === sessionId
	)
		return false;
	const tab = selectAttentionCenterTab(state, workspaceId);
	return tab?.kind === "chat" && tab.sessionId === sessionId;
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
			case "changes":
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

export function selectWorkspaceChatTab(
	state: {
		tabsByWorkspace: Record<string, EditorTab[]>;
		activeTabByWorkspace: Record<string, string | null>;
	},
	workspaceId: string,
): Extract<EditorTab, { kind: "chat" }> | null {
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	const active = selectActiveEditorTab(state, workspaceId);
	if (active?.kind === "chat") return active;
	const fallback = tabs.findLast((t) => t.kind === "chat");
	return fallback?.kind === "chat" ? fallback : null;
}

export function selectHistoryTarget(state: {
	activeWorkspaceId: string | null;
	tabsByWorkspace: Record<string, EditorTab[]>;
	activeTabByWorkspace: Record<string, string | null>;
}): HistoryTarget | null {
	const workspaceId = state.activeWorkspaceId;
	if (!workspaceId) return null;
	const chat = selectWorkspaceChatTab(state, workspaceId);
	return chat ? { workspaceId, tabId: chat.id, sessionId: chat.sessionId } : null;
}

export function selectRailPlanSessionId(
	state: {
		tabsByWorkspace: Record<string, EditorTab[]>;
		activeTabByWorkspace: Record<string, string | null>;
	},
	workspaceId: string,
): string | null {
	return selectWorkspaceChatTab(state, workspaceId)?.sessionId ?? null;
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
	return models.find((m) => sameModel(m, ref)) ?? null;
}

export const BRANCH_SCOPE: GitDiffScope = { kind: "branch" };

export function selectDiffScope(
	state: { diffScopeByWorkspace: Record<string, GitDiffScope> },
	workspaceId: string,
): GitDiffScope {
	return state.diffScopeByWorkspace[workspaceId] ?? BRANCH_SCOPE;
}

const EMPTY_FILES_TREE_VIEW: FilesTreeView = {
	expanded: [],
	changedCollapsed: [],
	scroll: {},
	seenActivePath: null,
};

export function selectFilesTreeView(
	state: { filesTreeByWorkspace: Record<string, FilesTreeView> },
	workspaceId: string,
): FilesTreeView {
	return state.filesTreeByWorkspace[workspaceId] ?? EMPTY_FILES_TREE_VIEW;
}

export function selectActiveFilePath(
	state: {
		tabsByWorkspace: Record<string, EditorTab[]>;
		activeTabByWorkspace: Record<string, string | null>;
	},
	workspaceId: string,
): string | null {
	const tab = selectActiveEditorTab(state, workspaceId);
	return tab?.kind === "file" || tab?.kind === "diff" ? normalizePath(tab.path) : null;
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

export function selectChangesTabSection(
	state: { tabsByWorkspace: Record<string, EditorTab[]> },
	workspaceId: string,
	tabId: string,
	path: string,
): ChangesTabSection | undefined {
	const tab = state.tabsByWorkspace[workspaceId]?.find((candidate) => candidate.id === tabId);
	return tab?.kind === "changes" ? tab.sections[path] : undefined;
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

export function workspaceName(
	t: Translator,
	workspace: { kind?: Workspace["kind"] | undefined; name: string },
): string {
	return workspace.kind === "default" && workspace.name === DEFAULT_WORKSPACE_NAME
		? t("store.workspace.defaultName")
		: workspace.name;
}

export function selectChatName(
	state: { tabsByWorkspace: Record<string, EditorTab[]> },
	workspaceId: string,
	sessionId: string,
): string {
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	return tabs.find((tab) => tab.kind === "chat" && tab.sessionId === sessionId)?.name ?? "";
}

export function selectChatTitle(
	t: Translator,
	state: { tabsByWorkspace: Record<string, EditorTab[]> },
	workspaceId: string,
	sessionId: string,
): string {
	return chatName(t, selectChatName(state, workspaceId, sessionId));
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

export function fsChangedPaths(change: {
	paths: readonly string[];
	truncated: boolean;
}): readonly string[] | null {
	return change.truncated || change.paths.length === 0 ? null : change.paths;
}

interface FileChangeState {
	connectionGeneration: number;
	fsChangesByWorkspace: Record<string, { paths: readonly string[]; truncated: boolean }>;
}

export function selectFileChangeSince(
	state: FileChangeState,
	previous: FileChangeState,
	workspaceId: string,
): readonly string[] | null | undefined {
	if (state.connectionGeneration !== previous.connectionGeneration) return null;
	const change = state.fsChangesByWorkspace[workspaceId];
	if (!change || change === previous.fsChangesByWorkspace[workspaceId]) return undefined;
	return fsChangedPaths(change);
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

export type ModelRef = Pick<WireModel, "provider" | "id">;

export function selectPickerModels(
	models: readonly WireModel[],
	hidden: readonly ModelRef[],
	keep: readonly (ModelRef | null | undefined)[],
): WireModel[] {
	return models.filter(
		(model) =>
			!hidden.some((h) => sameModel(h, model)) || keep.some((kept) => sameModel(kept, model)),
	);
}
