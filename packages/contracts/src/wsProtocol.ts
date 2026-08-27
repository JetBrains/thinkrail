import type {
	AppConfig,
	AppConfigUpdate,
	BranchList,
	DelegationRunDetails,
	DelegationRunStatus,
	DiffStats,
	EditorInfo,
	ExistingWorktreeCandidate,
	FileNode,
	GitCommit,
	GitDiffScope,
	GithubAuthStatus,
	GitStatus,
	HistoryScope,
	HistorySearchResult,
	JbcentralActionResult,
	JbcentralConnectResult,
	JbcentralLoginResult,
	LoginReply,
	OpenBranchReview,
	OpenPrResult,
	PrDraft,
	Project,
	ProjectPathStatus,
	ProviderStatusReport,
	ReviewAnchor,
	ReviewComment,
	ReviewCommentKind,
	ReviewCommentStatus,
	ReviewSnapshot,
	SpecGraphSnapshot,
	Template,
	TemplateInfo,
	TemplateScope,
	TodoItem,
	TodoPlan,
	TodoStatus,
	Workspace,
	WorkspaceLayoutSnapshot,
} from "./domain";
import { isDelegationRunDetails } from "./domain";
import type {
	AskUserAnswersDetails,
	AskUserQuestionResult,
	ExtUiResponse,
	ImageContent,
	QueueLane,
	RefreshedModels,
	RemovedQueuedMessage,
	SessionQueueContent,
	SessionStats,
	SessionSummary,
	SkillCatalogEntry,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireCustomMessage,
	WireModel,
} from "./piProtocol";

export interface TerminalDataPush {
	id: string;
	data: string;
	truncated?: boolean;
}

export interface TerminalExitPush {
	id: string;
	exitCode: number;
}

export interface TerminalDetachedPush {
	workspaceId: string;
	tabKey: string;
}

export const INITIAL_TERMINAL_TAB_KEY = "thinkrail-initial";

export interface TerminalTabInfo {
	tabKey: string;
	title: string;
}

export interface TerminalTabsPush {
	workspaceId: string;
	tabs: TerminalTabInfo[];
}

export const PROTOCOL_VERSION = 53;

export type HostPlatform = "darwin" | "linux" | "win32";

export interface ServerWelcome {
	protocolVersion: number;
	appVersion?: string;
	hostPlatform?: HostPlatform;
	projects: Project[];
	recentProjects: Project[];
	config: AppConfig;
}

export interface WorkspaceRemoved {
	projectId: string;
	id: string;
}

export type SessionCreatedPayload = SessionSummary;

export interface SessionDeletedPayload {
	workspaceId: string;
	sessionId: string;
}

export const WS_METHODS = {
	projectOpen: "project.open",
	projectList: "project.list",
	projectClose: "project.close",
	projectInspect: "project.inspect",
	projectInit: "project.init",
	projectHasSpecs: "project.hasSpecs",
	projectSetTrust: "project.setTrust",
	projectAcknowledgeSkills: "project.acknowledgeSkills",
	projectSetSkillEnabled: "project.setSkillEnabled",
	projectAliasSkills: "project.aliasSkills",
	projectSetGroupEnabled: "project.setGroupEnabled",
	projectSkills: "project.skills",
	workspaceCreate: "workspace.create",
	workspaceListExisting: "workspace.listExisting",
	workspaceOpenExisting: "workspace.openExisting",
	workspaceList: "workspace.list",
	workspaceOpenReview: "workspace.openReview",
	workspaceRemove: "workspace.remove",
	workspaceDiffStats: "workspace.diffStats",
	workspaceSetSkillOverride: "workspace.setSkillOverride",
	workspaceSetDiffBase: "workspace.setDiffBase",
	workspaceWatchReady: "workspace.watchReady",
	workspaceOpenIn: "workspace.openIn",
	workspaceReveal: "workspace.reveal",
	editorList: "editor.list",
	gitListBranches: "git.listBranches",
	gitPrefetch: "git.prefetch",
	githubAuthStatus: "github.authStatus",
	githubRefresh: "github.refresh",
	prPreview: "pr.preview",
	prOpen: "pr.open",
	fsReadDir: "fs.readDir",
	fsReadFile: "fs.readFile",
	specGraph: "spec.graph",
	todoList: "todo.list",
	todoAdd: "todo.add",
	todoUpdate: "todo.update",
	todoRemove: "todo.remove",
	todoReview: "todo.review",
	todoRequestFix: "todo.requestFix",
	todoStartReview: "todo.startReview",
	todoReviewAll: "todo.reviewAll",
	gitStatus: "git.status",
	gitDiffFile: "git.diffFile",
	gitListCommits: "git.listCommits",
	terminalReserve: "terminal.reserve",
	terminalAttach: "terminal.attach",
	terminalList: "terminal.list",
	terminalWrite: "terminal.write",
	terminalResize: "terminal.resize",
	terminalClose: "terminal.close",
	dialogSelectDirectory: "dialog.selectDirectory",
	skillList: "skill.list",
	skillsState: "skills.state",
	sessionCreate: "session.create",
	sessionPrompt: "session.prompt",
	sessionSteer: "session.steer",
	sessionFollowUp: "session.followUp",
	sessionClearQueue: "session.clearQueue",
	sessionRemoveQueued: "session.removeQueued",
	sessionAbort: "session.abort",
	sessionDispose: "session.dispose",
	sessionDelete: "session.delete",
	sessionSetModel: "session.setModel",
	sessionSetThinkingLevel: "session.setThinkingLevel",
	sessionCompact: "session.compact",
	sessionGetStats: "session.getStats",
	sessionGetCommands: "session.getCommands",
	sessionReloadResources: "session.reloadResources",
	sessionExtUiReply: "session.extUiReply",
	sessionAnswerQuestion: "session.answerQuestion",
	sessionList: "session.list",
	sessionGetMessages: "session.getMessages",
	subagentGetTranscript: "subagent.getTranscript",
	modelList: "model.list",
	modelRefresh: "model.refresh",
	modelDefault: "model.default",
	modelClampThinking: "model.clampThinking",
	providerStatus: "provider.status",
	providerLoginStart: "provider.loginStart",
	providerLoginReply: "provider.loginReply",
	providerLoginCancel: "provider.loginCancel",
	providerLogout: "provider.logout",
	providerJbcentralConnect: "provider.jbcentralConnect",
	providerJbcentralDisconnect: "provider.jbcentralDisconnect",
	providerJbcentralStartProxy: "provider.jbcentralStartProxy",
	providerJbcentralLogin: "provider.jbcentralLogin",
	providerJbcentralUpdate: "provider.jbcentralUpdate",
	layoutGet: "layout.get",
	settingsUpdate: "settings.update",
	historySearch: "history.search",
	reviewGet: "review.get",
	reviewCommentAdd: "review.commentAdd",
	reviewCommentUpdate: "review.commentUpdate",
	reviewCommentDelete: "review.commentDelete",
	reviewFileDone: "review.fileDone",
	reviewSendComment: "review.sendComment",
	reviewSendBatch: "review.sendBatch",
	reviewClose: "review.close",
	templateList: "template.list",
	templateGet: "template.get",
	templateSave: "template.save",
	templateDelete: "template.delete",
} as const;

export const WS_CHANNELS = {
	serverWelcome: "server.welcome",
	projectUpdated: "project.updated",
	piEvent: "pi.event",
	piExtensionUi: "pi.extensionUi",
	sessionCreated: "session.created",
	sessionDeleted: "session.deleted",
	providerLogin: "provider.login",
	providerChanged: "provider.changed",
	terminalData: "terminal.data",
	terminalExit: "terminal.exit",
	terminalDetached: "terminal.detached",
	terminalTabs: "terminal.tabs",
	workspaceCreated: "workspace.created",
	workspaceUpdated: "workspace.updated",
	workspaceRemoved: "workspace.removed",
	workspaceFsChanged: "workspace.fsChanged",
	settingsChanged: "settings.changed",
	reviewChanged: "review.changed",
} as const;

export type WsMethod = (typeof WS_METHODS)[keyof typeof WS_METHODS];
export type WsChannel = (typeof WS_CHANNELS)[keyof typeof WS_CHANNELS];

export const ASK_USER_ANSWERS_CUSTOM_TYPE = "ask-user-answers";

export interface AskUserAnswersMessage extends WireCustomMessage<AskUserAnswersDetails> {
	customType: typeof ASK_USER_ANSWERS_CUSTOM_TYPE;
	details: AskUserAnswersDetails;
}

export function isAskUserAnswersMessage(message: unknown): message is AskUserAnswersMessage {
	if (!message || typeof message !== "object") return false;
	const m = message as { role?: unknown; customType?: unknown; details?: unknown };
	if (m.role !== "custom" || m.customType !== ASK_USER_ANSWERS_CUSTOM_TYPE) return false;
	const details = m.details as Partial<AskUserAnswersDetails> | undefined;
	return (
		typeof details?.toolCallId === "string" &&
		!!details.result &&
		Array.isArray(details.result.answers) &&
		typeof details.result.cancelled === "boolean"
	);
}

export const SUBAGENT_COMPLETION_CUSTOM_TYPE = "subagent-completion";

export interface SubagentCompletionMessage extends WireCustomMessage<DelegationRunDetails> {
	customType: typeof SUBAGENT_COMPLETION_CUSTOM_TYPE;
	details: DelegationRunDetails;
}

export function isSubagentCompletionMessage(
	message: unknown,
): message is SubagentCompletionMessage {
	if (!message || typeof message !== "object") return false;
	const m = message as { role?: unknown; customType?: unknown; details?: unknown };
	if (m.role !== "custom" || m.customType !== SUBAGENT_COMPLETION_CUSTOM_TYPE) return false;
	return isDelegationRunDetails(m.details);
}

export function customMessageText(content: WireCustomMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
		.map((c) => c.text)
		.join("");
}

export interface Ack {
	ok: true;
}

export interface ReviewSendResult {
	sessionId: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	reused: boolean;
}

export interface WorkspaceWatchReadyResult {
	startupNudge: boolean;
}

export interface WsMethodMap {
	"project.open": { params: { path: string }; result: Project };
	"project.list": { params: Record<string, never>; result: Project[] };
	"project.close": { params: { id: string }; result: Ack };
	"project.inspect": { params: { path: string }; result: ProjectPathStatus };
	"project.init": { params: { path: string }; result: Project };
	"project.hasSpecs": { params: { projectId: string }; result: { hasSpecs: boolean } };
	"project.setTrust": { params: { id: string; trusted: boolean }; result: Project };
	"project.acknowledgeSkills": { params: { id: string; names: string[] }; result: Project };
	"project.setSkillEnabled": {
		params: { id: string; name: string; enabled: boolean };
		result: Project;
	};
	"project.aliasSkills": { params: { projectId: string }; result: string[] };
	"project.setGroupEnabled": {
		params: { id: string; group: string; enabled: boolean };
		result: Project;
	};
	"project.skills": { params: { projectId: string }; result: SkillCatalogEntry[] };
	"workspace.create": {
		params: { projectId: string; name?: string; baseRef?: string };
		result: Workspace;
	};
	"workspace.listExisting": {
		params: { projectId: string };
		result: ExistingWorktreeCandidate[];
	};
	"workspace.openExisting": {
		params: { projectId: string; path: string };
		result: Workspace;
	};
	"workspace.list": {
		params: { projectId: string; includeDiffStats?: boolean };
		result: Workspace[];
	};
	"workspace.openReview": {
		params: { workspaceId: string };
		result: OpenBranchReview | null;
	};
	"workspace.remove": { params: { id: string }; result: Ack };
	"workspace.diffStats": { params: { id: string }; result: DiffStats };
	"workspace.setSkillOverride": {
		params: { id: string; name: string; override: "on" | "off" | null };
		result: Workspace;
	};
	"workspace.setDiffBase": { params: { id: string; ref: string | null }; result: Workspace };
	"workspace.watchReady": {
		params: { workspaceId: string; prewarm?: boolean };
		result: WorkspaceWatchReadyResult;
	};
	"workspace.openIn": { params: { id: string; editor: string }; result: Ack };
	"workspace.reveal": { params: { id: string }; result: Ack };
	"editor.list": { params: Record<string, never>; result: EditorInfo[] };
	"git.listBranches": { params: { projectId: string }; result: BranchList };
	"git.prefetch": { params: { projectId: string; ref: string }; result: { ok: boolean } };
	"github.authStatus": { params: Record<string, never>; result: GithubAuthStatus };
	"github.refresh": { params: Record<string, never>; result: GithubAuthStatus };
	"pr.preview": {
		params: { workspaceId: string; sessionId: string; title?: string };
		result: PrDraft;
	};
	"pr.open": {
		params: {
			workspaceId: string;
			sessionId: string;
			title?: string;
			titleEdited?: boolean;
			body?: string;
			draft?: boolean;
		};
		result: OpenPrResult;
	};
	"fs.readDir": { params: { workspaceId: string; path: string }; result: FileNode[] };
	"fs.readFile": { params: { workspaceId: string; path: string }; result: { content: string } };
	"spec.graph": { params: { workspaceId: string }; result: SpecGraphSnapshot };
	"todo.list": {
		params: { workspaceId: string; sessionId: string };
		result: TodoPlan;
	};
	"todo.add": {
		params: { workspaceId: string; sessionId: string; title: string; note?: string };
		result: TodoItem;
	};
	"todo.update": {
		params: {
			workspaceId: string;
			sessionId: string;
			id: string;
			status?: TodoStatus;
			title?: string;
			note?: string;
		};
		result: TodoItem;
	};
	"todo.remove": { params: { workspaceId: string; sessionId: string; id: string }; result: Ack };
	"todo.review": { params: { workspaceId: string; sessionId: string; id: string }; result: Ack };
	"todo.requestFix": {
		params: { workspaceId: string; sessionId: string; id: string; feedback: string };
		result: Ack;
	};
	"todo.startReview": {
		params: { workspaceId: string; sessionId: string; id: string };
		result: { ok: true; reviewerSessionId: string };
	};
	"todo.reviewAll": {
		params: { workspaceId: string; sessionId: string };
		result: { ok: true; total: number; alreadyRunning?: true };
	};
	"git.status": { params: { workspaceId: string; scope?: GitDiffScope }; result: GitStatus };
	"git.diffFile": {
		params: { workspaceId: string; path: string; scope?: GitDiffScope };
		result: { original: string; modified: string };
	};
	"git.listCommits": { params: { workspaceId: string }; result: { commits: GitCommit[] } };
	"terminal.reserve": {
		params: { workspaceId: string; tabKey: string; title: string };
		result: { tab: TerminalTabInfo };
	};
	"terminal.attach": {
		params: { workspaceId: string; tabKey: string; title?: string; cols?: number; rows?: number };
		result: { id: string; created: boolean; replay?: string };
	};
	"terminal.list": {
		params: { workspaceId: string };
		result: { tabs: TerminalTabInfo[] };
	};
	"terminal.write": { params: { id: string; data: string }; result: Ack };
	"terminal.resize": { params: { id: string; cols: number; rows: number }; result: Ack };
	"terminal.close": {
		params: { workspaceId: string; tabKey: string; force?: boolean };
		result: { closed: boolean; busy: boolean };
	};
	"dialog.selectDirectory": { params: Record<string, never>; result: { path: string | null } };
	"skill.list": { params: { projectId: string }; result: SlashCommandInfo[] };
	"skills.state": { params: { workspaceId: string }; result: SkillCatalogEntry[] };
	"session.create": {
		params: { workspaceId: string; model?: WireModel; thinkingLevel?: ThinkingLevel };
		result: { sessionId: string; model: WireModel | null; thinkingLevel: ThinkingLevel };
	};
	"session.prompt": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.steer": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.followUp": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.clearQueue": {
		params: { sessionId: string; requireTextOnly?: boolean };
		result: SessionQueueContent;
	};
	"session.removeQueued": {
		params: { sessionId: string; kind: QueueLane; index: number };
		result: RemovedQueuedMessage;
	};
	"session.abort": {
		params: { sessionId: string; restoreQueue?: boolean };
		result: Ack & { restoredQueue?: SessionQueueContent };
	};
	"session.dispose": { params: { sessionId: string }; result: Ack };
	"session.delete": { params: { workspaceId: string; sessionId: string }; result: Ack };
	"session.setModel": { params: { sessionId: string; model: WireModel }; result: Ack };
	"session.setThinkingLevel": { params: { sessionId: string; level: ThinkingLevel }; result: Ack };
	"session.compact": { params: { sessionId: string; instructions?: string }; result: Ack };
	"session.getStats": { params: { sessionId: string }; result: SessionStats };
	"session.getCommands": { params: { sessionId: string }; result: SlashCommandInfo[] };
	"session.reloadResources": { params: { sessionId: string }; result: Ack };
	"session.extUiReply": { params: { response: ExtUiResponse }; result: Ack };
	"session.answerQuestion": {
		params: { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		result: Ack;
	};
	"session.list": { params: { workspaceId: string }; result: SessionSummary[] };
	"session.getMessages": {
		params: { sessionId: string; workspaceId: string };
		result: { summary: SessionSummary; messages: TranscriptMessage[] };
	};
	"subagent.getTranscript": {
		params: { workspaceId: string; parentSessionId: string; childSessionId: string };
		result: { messages: TranscriptMessage[]; status?: DelegationRunStatus };
	};
	"model.list": { params: Record<string, never>; result: WireModel[] };
	"model.clampThinking": {
		params: { provider: string; id: string; level: ThinkingLevel };
		result: { level: ThinkingLevel };
	};
	"model.refresh": { params: { force?: boolean }; result: RefreshedModels };
	"model.default": {
		params: Record<string, never>;
		result: { model: WireModel | null; thinkingLevel: ThinkingLevel };
	};
	"provider.status": { params: Record<string, never>; result: ProviderStatusReport };
	"provider.loginStart": {
		params: { providerId: string; type?: "oauth" | "api_key" };
		result: { loginId: string };
	};
	"provider.loginReply": { params: LoginReply; result: Ack };
	"provider.loginCancel": { params: { loginId: string }; result: Ack };
	"provider.logout": { params: { providerId: string }; result: Ack };
	"provider.jbcentralConnect": { params: Record<string, never>; result: JbcentralConnectResult };
	"provider.jbcentralDisconnect": { params: Record<string, never>; result: JbcentralActionResult };
	"provider.jbcentralStartProxy": { params: Record<string, never>; result: JbcentralActionResult };
	"provider.jbcentralLogin": { params: Record<string, never>; result: JbcentralLoginResult };
	"provider.jbcentralUpdate": { params: Record<string, never>; result: JbcentralActionResult };
	"layout.get": {
		params: { workspaceId: string };
		result: WorkspaceLayoutSnapshot | null;
	};
	"settings.update": { params: { config: AppConfigUpdate }; result: AppConfig };
	"history.search": {
		params: { query: string; scope: HistoryScope; limit?: number };
		result: HistorySearchResult;
	};
	"review.get": { params: { workspaceId: string }; result: ReviewSnapshot };
	"review.commentAdd": {
		params: {
			workspaceId: string;
			kind: ReviewCommentKind;
			anchor: ReviewAnchor | null;
			body: string;
			scope?: GitDiffScope;
		};
		result: ReviewComment;
	};
	"review.commentUpdate": {
		params: { workspaceId: string; id: string; body?: string; status?: ReviewCommentStatus };
		result: ReviewComment;
	};
	"review.sendComment": {
		params: {
			workspaceId: string;
			id: string;
			sessionId?: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
		};
		result: ReviewSendResult;
	};
	"review.sendBatch": {
		params: {
			workspaceId: string;
			commentIds?: string[];
			sessionId?: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
		};
		result: { sessions: ReviewSendResult[] };
	};
	"review.commentDelete": { params: { workspaceId: string; id: string }; result: Ack };
	"review.fileDone": { params: { workspaceId: string; path: string }; result: Ack };
	"review.close": { params: { workspaceId: string }; result: Ack };
	"template.list": {
		params: { workspaceId?: string };
		result: { templates: TemplateInfo[] };
	};
	"template.get": {
		params: { workspaceId?: string; name: string; scope?: TemplateScope };
		result: Template;
	};
	"template.save": {
		params: {
			workspaceId?: string;
			scope: TemplateScope;
			name: string;
			content: string;
		};
		result: Template;
	};
	"template.delete": {
		params: { workspaceId?: string; scope: TemplateScope; name: string };
		result: Ack;
	};
}

export type WsMethodName = keyof WsMethodMap;
export type WsParams<M extends WsMethodName> = WsMethodMap[M]["params"];
export type WsResult<M extends WsMethodName> = WsMethodMap[M]["result"];

export interface WsRequest<M extends WsMethodName = WsMethodName> {
	id: string;
	method: M;
	params: WsParams<M>;
	sessionId?: string;
}

export interface WsAck {
	ack: string[];
}

export interface WsResume {
	resume: string[];
}

export type WsClientMessage = WsRequest | WsAck | WsResume;

export type WsErrorCode = "UNKNOWN_COMMIT" | "PUSH_AUTH_FAILED" | "SUBAGENT_TRANSCRIPT_NOT_FOUND";

export interface WsResponse {
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
	errorCode?: WsErrorCode;
}

export interface WsPush {
	channel: WsChannel;
	data: unknown;
}

export type WsServerMessage = WsResponse | WsPush;
