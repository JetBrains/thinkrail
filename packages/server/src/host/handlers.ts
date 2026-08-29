import type {
	AppConfigUpdate,
	AskUserQuestionResult,
	ExtUiResponse,
	GitDiffScope,
	HistoryScope,
	ImageContent,
	LoginReply,
	QueueLane,
	ReviewAnchor,
	ReviewComment,
	ReviewCommentKind,
	ReviewCommentStatus,
	ReviewSendResult,
	TemplateScope,
	ThinkingLevel,
	TodoStatus,
	WireModel,
	Workspace,
} from "@thinkrail/contracts";
import { isControlMessage } from "@thinkrail/contracts";
import {
	abortSession,
	answerQuestion,
	clampThinkingForModel,
	clearQueueSession,
	compactSession,
	createSession,
	deleteSession,
	ensureSessionAttached,
	followUpSession,
	getDefaultModel,
	getSessionCommands,
	getSessionMessages,
	getSessionStats,
	hasSession,
	isSessionStreaming,
	listAvailableModels,
	listProjectAliasSkillNames,
	listSessions,
	listSkillCatalog,
	listSkillCommands,
	notifyExtUi,
	promptSession,
	readChildTranscript,
	refreshAvailableModels,
	reloadSessionResources,
	removeQueuedSession,
	removeSession,
	removeWorkspaceSessions,
	resolveExtUi,
	setSessionModel,
	setSessionThinkingLevel,
	steerSession,
} from "../agent";
import { bucketProviderModel, type SendMode, track } from "../analytics";
import {
	cancelLogin,
	connectJbcentral,
	disconnectJbcentral,
	getProviderStatus,
	jbcentralLogin,
	logoutProvider,
	resolveLogin,
	startLogin,
	startProxyJbcentral,
	updateJbcentral,
} from "../auth";
import { findOpenBranchReview } from "../branch-review";
import { selectDirectory } from "../dialog";
import { listAvailableEditors, openEditor, revealInFileManager } from "../editors";
import { readDir, readFile } from "../fs";
import {
	countUnpushedCommits,
	gitDiffFile,
	gitStatus,
	listBranches,
	listCommits,
	prefetchBranch,
} from "../git";
import { githubAuthStatus, githubRefresh } from "../github";
import { clampLimit, getHistoryIndex } from "../history";
import { logger } from "../log";
import { openPr, previewPr } from "../pr";
import {
	acknowledgeProjectSkills,
	closeProject,
	initProject,
	inspectProjectPath,
	listProjects,
	openProject,
	setProjectGroupEnabled,
	setProjectSkillEnabled,
	setProjectTrust,
} from "../projects";
import {
	addComment,
	buildSendPackage,
	clearReview,
	deleteComment,
	fileReviewSession,
	getReviewSnapshot,
	markCommentsSent,
	markFileDone,
	REVIEW_LEVEL_KEY,
	removeWorkspaceReviews,
	reviewSessionKey,
	rollbackSend,
	sendableComments,
	updateComment,
} from "../reviews";
import { updateConfig } from "../settings";
import { evictSpecIndex, projectHasSpecs, specGraph } from "../spec";
import {
	deleteTemplate,
	getTemplate,
	listTemplates,
	saveTemplate,
	templateDirs,
} from "../templates";
import {
	attachTerminal,
	closeTerminalTab,
	closeWorkspaceTerminals,
	listTerminals,
	reserveTerminal,
	resizeTerminal,
	writeTerminal,
} from "../terminal";
import {
	addTodo,
	approveTodoReview,
	countOpenTodos,
	listTodos,
	removeSessionTodoWindows,
	removeTodo,
	requestTodoFix,
	rollbackTodoFix,
	type TodoReviewRecord,
	updateTodo,
} from "../todos";
import { ensureWatch, stopWatch } from "../watch";
import {
	createWorkspace,
	ensureWorkspaceScratchDir,
	forgetWorkspace,
	getWorkspace,
	listExistingWorktrees,
	listWorkspaceRecords,
	listWorkspaces,
	openExistingWorktree,
	reclaimWorktree,
	setWorkspaceDiffBase,
	setWorkspaceSkillOverride,
	workspaceDiffStats,
} from "../workspaces";
import { ackSend } from "./ackSend";
import { nudgeBaseRefWorkspaces } from "./fsNudge";
import { buildHistoryScope } from "./historyScope";
import { provisionInitialTerminal } from "./initialTerminal";
import { dropLogin, recordLoginStart } from "./loginAnalytics";
import { withReviewLock } from "./reviewLock";
import {
	isItemUnderActiveReview,
	itemFixFindings,
	markClientStale,
	startReviewAllFlow,
	startTodoReviewFlow,
} from "./todoReview";

const log = logger("host");

export interface RequestContext {
	clientKey: string;
}

type Handler = (params: unknown, ctx: RequestContext) => unknown | Promise<unknown>;

async function archiveTeardown(ws: Workspace): Promise<void> {
	try {
		await removeWorkspaceSessions(ws.id, ws.worktreePath);
		reclaimWorktree(ws);
	} catch {
		log.warn(`workspace archive teardown failed for ${ws.id}`);
	}
}

function trackSend(mode: SendMode, text: string): void {
	if (isControlMessage(text)) return;
	track({ name: "message_sent", params: { mode } });
}

function fireReviewPrompt(
	workspaceId: string,
	ids: string[],
	sessionId: string,
	pkg: string,
	send: (sessionId: string, text: string) => Promise<void> = promptSession,
): void {
	void ackSend(send(sessionId, pkg))
		.then(undefined, (err) => {
			rollbackSend(workspaceId, ids, sessionId);
			notifyExtUi(
				sessionId,
				`Review send failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
		})
		.catch(() => {
			log.warn("review send rollback failed");
		});
}

function fireTodoFixPrompt(
	p: { workspaceId: string; sessionId: string; id: string },
	pkg: string,
	previous: TodoReviewRecord | undefined,
	findingIds: string[] = [],
): void {
	void ackSend(followUpSession(p.sessionId, pkg))
		.then(undefined, (err) => {
			rollbackTodoFix(p, previous);
			if (findingIds.length > 0) rollbackSend(p.workspaceId, findingIds, p.sessionId);
			notifyExtUi(
				p.sessionId,
				`Fix request send failed: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
		})
		.catch((err) => {
			console.warn(`todo fix rollback failed: ${err instanceof Error ? err.message : err}`);
		});
}

async function sendToFileChat(
	workspaceId: string,
	comments: ReviewComment[],
	opts: { model?: WireModel; thinkingLevel?: ThinkingLevel; sessionId?: string },
): Promise<ReviewSendResult> {
	const ids = comments.map((c) => c.id);
	const pkg = buildSendPackage(workspaceId, comments);
	const ws = getWorkspace(workspaceId);
	const first = comments[0];
	const path = first ? reviewSessionKey(first) : REVIEW_LEVEL_KEY;
	const existing = opts.sessionId ?? fileReviewSession(workspaceId, path);
	if (existing && (await ensureSessionAttached(existing, workspaceId, ws.worktreePath))) {
		markCommentsSent(workspaceId, ids, existing);
		fireReviewPrompt(workspaceId, ids, existing, pkg, followUpSession);
		return {
			sessionId: existing,
			model: null,
			thinkingLevel: "medium" as ThinkingLevel,
			reused: true,
		};
	}
	if (existing) {
		log.warn(
			`review ${workspaceId}: linked chat ${existing} is no longer on disk — starting a new review chat`,
		);
	}
	ensureWorkspaceScratchDir(ws);
	const created = await createSession({
		cwd: ws.worktreePath,
		workspaceId,
		...(opts.model ? { model: opts.model } : {}),
		...(opts.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
	});
	if (created.model) {
		track({
			name: "chat_started",
			params: bucketProviderModel(created.model.provider, created.model.id),
		});
	}
	markCommentsSent(workspaceId, ids, created.sessionId);
	fireReviewPrompt(workspaceId, ids, created.sessionId, pkg);
	return { ...created, reused: false };
}

const handlers: Record<string, Handler> = {
	"project.open": (params) => openProject((params as { path: string }).path),
	"project.inspect": (params) => inspectProjectPath((params as { path: string }).path),
	"project.init": (params) => initProject((params as { path: string }).path),
	"project.list": () => listProjects(),
	"project.hasSpecs": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((p) => p.id === projectId);
		return { hasSpecs: project ? projectHasSpecs(project.path) : false };
	},
	"project.close": (params) => {
		closeProject((params as { id: string }).id);
		return { ok: true } as const;
	},
	"project.setTrust": async (params) => {
		const p = params as { id: string; trusted: boolean };
		const project = listProjects().find((candidate) => candidate.id === p.id);
		if (!project) throw new Error(`Unknown project: ${p.id}`);
		const acknowledged = p.trusted ? await listProjectAliasSkillNames(project.path) : undefined;
		return setProjectTrust(p.id, p.trusted, acknowledged);
	},
	"workspace.create": async (params) => {
		const p = params as { projectId: string; name?: string; baseRef?: string };
		return provisionInitialTerminal(await createWorkspace(p.projectId, p.name, p.baseRef));
	},
	"workspace.listExisting": (params) =>
		listExistingWorktrees((params as { projectId: string }).projectId),
	"workspace.openExisting": (params) => {
		const p = params as { projectId: string; path: string };
		return provisionInitialTerminal(openExistingWorktree(p.projectId, p.path));
	},
	"workspace.list": (params) => {
		const p = params as { projectId: string; includeDiffStats?: boolean };
		return listWorkspaces(p.projectId, { includeDiffStats: p.includeDiffStats ?? true }).map(
			(workspace) => ({ ...workspace, ...provisionInitialTerminal(workspace) }),
		);
	},
	"workspace.openReview": async (params) => {
		const ws = getWorkspace((params as { workspaceId: string }).workspaceId);
		const [review, unpushed] = await Promise.all([
			findOpenBranchReview(ws.worktreePath, ws.branch),
			countUnpushedCommits(ws.worktreePath, ws.branch),
		]);
		if (!review) return review;
		return unpushed ? { ...review, unpushedCommits: unpushed } : review;
	},
	"workspace.remove": (params) => {
		const id = (params as { id: string }).id;
		const ws = forgetWorkspace(id);
		if (ws) {
			evictSpecIndex(ws.id);
			removeWorkspaceReviews(ws.id);
			stopWatch(ws.id);
			closeWorkspaceTerminals(ws.id);
			void archiveTeardown(ws);
		}
		return { ok: true } as const;
	},
	"workspace.diffStats": (params) => workspaceDiffStats((params as { id: string }).id),
	"workspace.openIn": (params) => {
		const p = params as { id: string; editor: string };
		openEditor(p.editor, getWorkspace(p.id).worktreePath);
		return { ok: true } as const;
	},
	"workspace.reveal": (params) => {
		revealInFileManager(getWorkspace((params as { id: string }).id).worktreePath);
		return { ok: true } as const;
	},
	"editor.list": () => listAvailableEditors(),
	"git.listBranches": (params) => listBranches((params as { projectId: string }).projectId),
	"git.prefetch": async (params) => {
		const p = params as { projectId: string; ref: string };
		const { ok, moved } = await prefetchBranch(p.projectId, p.ref);
		if (moved) nudgeBaseRefWorkspaces(p.projectId, p.ref);
		return { ok };
	},
	"github.authStatus": () => githubAuthStatus(),
	"github.refresh": () => githubRefresh(),
	"pr.preview": (params) =>
		previewPr(params as { workspaceId: string; sessionId: string; title?: string }),
	"pr.open": (params) =>
		openPr(
			params as {
				workspaceId: string;
				sessionId: string;
				title?: string;
				titleEdited?: boolean;
				body?: string;
				draft?: boolean;
			},
		),
	"dialog.selectDirectory": () => selectDirectory(),
	"fs.readDir": (params) => {
		const p = params as { workspaceId: string; path: string };
		void ensureWatch(p.workspaceId);
		return readDir(p.workspaceId, p.path);
	},
	"fs.readFile": (params) => {
		const p = params as { workspaceId: string; path: string };
		void ensureWatch(p.workspaceId);
		return readFile(p.workspaceId, p.path);
	},
	"spec.graph": (params) => {
		const p = params as { workspaceId: string };
		void ensureWatch(p.workspaceId);
		return specGraph(p.workspaceId);
	},
	"todo.list": (params) => listTodos(params as { workspaceId: string; sessionId: string }),
	"todo.add": (params) =>
		addTodo(params as { workspaceId: string; sessionId: string; title: string; note?: string }),
	"todo.update": (params) =>
		updateTodo(
			params as {
				workspaceId: string;
				sessionId: string;
				id: string;
				status?: TodoStatus;
				title?: string;
				note?: string;
			},
		),
	"todo.remove": (params) => {
		const p = params as { workspaceId: string; sessionId: string; id: string };
		// See host/SPEC.md (todo.remove) — this covers the tail removeTodo's own pending check can't.
		if (isItemUnderActiveReview(p.sessionId, p.id)) {
			throw new Error(
				`TODO "${p.id}" is currently under review — cancel or wait for the review to finish before removing it.`,
			);
		}
		return removeTodo(p);
	},
	"todo.review": (params) =>
		approveTodoReview(params as { workspaceId: string; sessionId: string; id: string }),
	"todo.startReview": (params) =>
		startTodoReviewFlow(params as { workspaceId: string; sessionId: string; id: string }),
	"todo.reviewAll": (params) =>
		startReviewAllFlow(params as { workspaceId: string; sessionId: string }),
	"todo.requestFix": async (params) => {
		const p = params as { workspaceId: string; sessionId: string; id: string; feedback: string };
		const ws = getWorkspace(p.workspaceId);
		const { pkg, previous } = requestTodoFix(p);
		if (!(await ensureSessionAttached(p.sessionId, p.workspaceId, ws.worktreePath))) {
			rollbackTodoFix(p, previous);
			throw new Error("This plan's chat is no longer on disk — can't send the fix request.");
		}
		const { fixText, findingIds } = await withReviewLock(p.workspaceId, async () => {
			const findings = itemFixFindings(p);
			if (findings.length === 0) return { fixText: pkg, findingIds: [] as string[] };
			const ids = findings.map((c) => c.id);
			markCommentsSent(p.workspaceId, ids, p.sessionId);
			return { fixText: `${pkg}\n\n${buildSendPackage(p.workspaceId, findings)}`, findingIds: ids };
		});
		fireTodoFixPrompt(p, fixText, previous, findingIds);
		return { ok: true } as const;
	},
	"git.status": (params) => {
		const p = params as { workspaceId: string; scope?: GitDiffScope };
		void ensureWatch(p.workspaceId);
		return gitStatus(p.workspaceId, p.scope);
	},

	"git.diffFile": (params) => {
		const p = params as { workspaceId: string; path: string; scope?: GitDiffScope };
		void ensureWatch(p.workspaceId);
		return gitDiffFile(p.workspaceId, p.path, p.scope);
	},
	"git.listCommits": (params) => listCommits((params as { workspaceId: string }).workspaceId),
	"terminal.reserve": (params) => {
		const p = params as { workspaceId: string; tabKey: string; title: string };
		getWorkspace(p.workspaceId);
		return { tab: reserveTerminal(p.workspaceId, p.tabKey, p.title) };
	},
	"terminal.attach": (params, ctx) => {
		const p = params as {
			workspaceId: string;
			tabKey: string;
			title?: string;
			cols?: number;
			rows?: number;
		};
		return attachTerminal(p.workspaceId, p.tabKey, ctx.clientKey, p);
	},
	"terminal.list": (params) => ({
		tabs: listTerminals((params as { workspaceId: string }).workspaceId),
	}),
	"terminal.write": (params, ctx) => {
		const p = params as { id: string; data: string };
		writeTerminal(p.id, p.data, ctx.clientKey);
		return { ok: true } as const;
	},
	"terminal.resize": (params, ctx) => {
		const p = params as { id: string; cols: number; rows: number };
		resizeTerminal(p.id, p.cols, p.rows, ctx.clientKey);
		return { ok: true } as const;
	},
	"terminal.close": (params) => {
		const p = params as { workspaceId: string; tabKey: string; force?: boolean };
		return closeTerminalTab(p.workspaceId, p.tabKey, p.force ?? false);
	},
	"skill.list": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((candidate) => candidate.id === projectId);
		if (!project) throw new Error(`Unknown project: ${projectId}`);
		return listSkillCommands(project.path, {
			trusted: project.trusted === true,
			acknowledged: project.acknowledgedSkills ?? [],
			disabled: project.disabledSkills ?? [],
			disabledGroups: project.disabledGroups ?? [],
			overrides: {},
		});
	},
	"skills.state": (params) => {
		const { workspaceId } = params as { workspaceId: string };
		const ws = getWorkspace(workspaceId);
		const project = listProjects().find((p) => p.id === ws.projectId);
		return listSkillCatalog(ws.worktreePath, {
			trusted: project?.trusted === true,
			acknowledged: project?.acknowledgedSkills ?? [],
			disabled: project?.disabledSkills ?? [],
			disabledGroups: project?.disabledGroups ?? [],
			overrides: ws.skillOverrides ?? {},
		});
	},
	"project.acknowledgeSkills": (params) => {
		const p = params as { id: string; names: string[] };
		return acknowledgeProjectSkills(p.id, p.names);
	},
	"project.setSkillEnabled": (params) => {
		const p = params as { id: string; name: string; enabled: boolean };
		return setProjectSkillEnabled(p.id, p.name, p.enabled);
	},
	"project.aliasSkills": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((p) => p.id === projectId);
		if (!project) throw new Error(`Unknown project: ${projectId}`);
		return listProjectAliasSkillNames(project.path);
	},
	"project.setGroupEnabled": (params) => {
		const p = params as { id: string; group: string; enabled: boolean };
		return setProjectGroupEnabled(p.id, p.group, p.enabled);
	},
	"project.skills": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((p) => p.id === projectId);
		if (!project) throw new Error(`Unknown project: ${projectId}`);
		return listSkillCatalog(project.path, {
			trusted: project.trusted === true,
			acknowledged: project.acknowledgedSkills ?? [],
			disabled: project.disabledSkills ?? [],
			disabledGroups: project.disabledGroups ?? [],
			overrides: {},
		});
	},
	"workspace.setSkillOverride": (params) => {
		const p = params as { id: string; name: string; override: "on" | "off" | null };
		return setWorkspaceSkillOverride(p.id, p.name, p.override);
	},
	"workspace.setDiffBase": (params) => {
		const p = params as { id: string; ref: string | null };
		return setWorkspaceDiffBase(p.id, p.ref);
	},
	"workspace.watchReady": (params) => {
		const p = params as { workspaceId: string; prewarm?: boolean };
		return ensureWatch(p.workspaceId, { prewarm: p.prewarm === true });
	},
	"session.reloadResources": async (params) => {
		await reloadSessionResources((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	"session.create": async (params) => {
		const p = params as {
			workspaceId: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
		};
		const ws = getWorkspace(p.workspaceId);
		ensureWorkspaceScratchDir(ws);
		const created = await createSession({
			cwd: ws.worktreePath,
			workspaceId: p.workspaceId,
			...(p.model ? { model: p.model } : {}),
			...(p.thinkingLevel ? { thinkingLevel: p.thinkingLevel } : {}),
		});
		if (created.model) {
			track({
				name: "chat_started",
				params: bucketProviderModel(created.model.provider, created.model.id),
			});
		}
		return created;
	},
	"session.prompt": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(promptSession(p.sessionId, p.text, p.images));
		trackSend("prompt", p.text);
		return { ok: true } as const;
	},
	"session.steer": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(steerSession(p.sessionId, p.text, p.images));
		trackSend("steer", p.text);
		return { ok: true } as const;
	},
	"session.followUp": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(followUpSession(p.sessionId, p.text, p.images));
		trackSend("follow_up", p.text);
		return { ok: true } as const;
	},
	"session.clearQueue": (params) => {
		const p = params as { sessionId: string; requireTextOnly?: boolean };
		return clearQueueSession(p.sessionId, p.requireTextOnly);
	},
	"session.removeQueued": async (params) => {
		const p = params as { sessionId: string; kind: QueueLane; index: number };
		return removeQueuedSession(p.sessionId, p.kind, p.index);
	},
	"session.abort": async (params) => {
		const p = params as { sessionId: string; restoreQueue?: boolean };
		const restoredQueue = await abortSession(p.sessionId, p.restoreQueue);
		return {
			ok: true,
			...(restoredQueue ? { restoredQueue } : {}),
		} as const;
	},
	"session.dispose": async (params) => {
		const { sessionId } = params as { sessionId: string };
		if (isSessionStreaming(sessionId)) await abortSession(sessionId).catch(() => {});
		await removeSession(sessionId);
		return { ok: true } as const;
	},
	"session.delete": async (params) => {
		const p = params as { workspaceId: string; sessionId: string };
		await deleteSession(p.sessionId, p.workspaceId, getWorkspace(p.workspaceId).worktreePath);
		removeSessionTodoWindows(p);
		return { ok: true } as const;
	},
	"session.setModel": async (params) => {
		const p = params as { sessionId: string; model: WireModel };
		await setSessionModel(p.sessionId, p.model);
		return { ok: true } as const;
	},
	"session.setThinkingLevel": (params) => {
		const p = params as { sessionId: string; level: ThinkingLevel };
		setSessionThinkingLevel(p.sessionId, p.level);
		return { ok: true } as const;
	},
	"session.compact": async (params) => {
		const p = params as { sessionId: string; instructions?: string };
		await compactSession(p.sessionId, p.instructions);
		return { ok: true } as const;
	},
	"session.getStats": (params) => getSessionStats((params as { sessionId: string }).sessionId),
	"session.getCommands": (params) =>
		getSessionCommands((params as { sessionId: string }).sessionId),
	"session.list": async (params) => {
		const { workspaceId } = params as { workspaceId: string };
		const summaries = await listSessions(workspaceId, getWorkspace(workspaceId).worktreePath);
		return summaries.map((summary) => {
			try {
				return {
					...summary,
					openTodos: countOpenTodos({ workspaceId, sessionId: summary.sessionId }),
				};
			} catch {
				return summary;
			}
		});
	},
	"session.getMessages": (params) => {
		const p = params as { sessionId: string; workspaceId: string };
		return getSessionMessages(p.sessionId, p.workspaceId, getWorkspace(p.workspaceId).worktreePath);
	},
	"subagent.getTranscript": (params) => {
		const p = params as { workspaceId: string; parentSessionId: string; childSessionId: string };
		getWorkspace(p.workspaceId);
		return readChildTranscript(p.workspaceId, p.parentSessionId, p.childSessionId);
	},
	"session.extUiReply": (params) => {
		resolveExtUi((params as { response: ExtUiResponse }).response);
		return { ok: true } as const;
	},
	"session.answerQuestion": async (params) => {
		const p = params as { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		if (!hasSession(p.sessionId)) throw new Error(`Unknown session: ${p.sessionId}`);
		if (!p.result || !Array.isArray(p.result.answers) || typeof p.result.cancelled !== "boolean")
			throw new Error("Malformed ask_user_question result");
		await ackSend(answerQuestion(p.sessionId, p.toolCallId, p.result));
		return { ok: true } as const;
	},
	"model.list": () => listAvailableModels(),
	"model.clampThinking": async (params) => {
		const p = params as { provider: string; id: string; level: ThinkingLevel };
		return { level: await clampThinkingForModel({ provider: p.provider, id: p.id }, p.level) };
	},
	"model.refresh": (params) => {
		const p = params as { force?: boolean };
		return refreshAvailableModels(p.force === true);
	},
	"model.default": () => getDefaultModel(),
	"provider.status": () => getProviderStatus(),
	"provider.loginStart": (params) => {
		const p = params as { providerId: string; type?: "oauth" | "api_key" };
		const type = p.type ?? "oauth";
		const handle = startLogin(p.providerId, type);
		recordLoginStart(handle.loginId, type);
		return handle;
	},
	"provider.loginReply": (params) => {
		resolveLogin(params as LoginReply);
		return { ok: true } as const;
	},
	"provider.loginCancel": (params) => {
		const { loginId } = params as { loginId: string };
		cancelLogin(loginId);
		dropLogin(loginId);
		return { ok: true } as const;
	},
	"provider.logout": async (params) => {
		await logoutProvider((params as { providerId: string }).providerId);
		return { ok: true } as const;
	},
	"provider.jbcentralConnect": () => connectJbcentral(),
	"provider.jbcentralDisconnect": () => disconnectJbcentral(),
	"provider.jbcentralStartProxy": () => startProxyJbcentral(),
	"provider.jbcentralLogin": () => jbcentralLogin(),
	"provider.jbcentralUpdate": () => updateJbcentral(),
	"settings.update": (params) => {
		const config = (params as { config: AppConfigUpdate }).config;
		return updateConfig(config);
	},
	"history.search": (params) => {
		const p = params as { query: string; scope: HistoryScope; limit?: number };
		const { filter, labels } = buildHistoryScope(p.scope, listProjects(), (projectId) =>
			listWorkspaceRecords(projectId),
		);
		return getHistoryIndex().search({
			query: p.query,
			filter,
			labels,
			limit: clampLimit(p.limit),
		});
	},
	"review.get": (params) => {
		const p = params as { workspaceId: string };
		ensureWatch(p.workspaceId);
		return markClientStale(getReviewSnapshot(p.workspaceId), p.workspaceId);
	},
	"review.commentAdd": (params) => {
		const p = params as {
			workspaceId: string;
			kind: ReviewCommentKind;
			anchor: ReviewAnchor | null;
			body: string;
			scope?: GitDiffScope;
		};
		return withReviewLock(p.workspaceId, async () => addComment(p));
	},
	"review.commentUpdate": (params) => {
		const p = params as {
			workspaceId: string;
			id: string;
			body?: string;
			status?: ReviewCommentStatus;
		};
		return withReviewLock(p.workspaceId, async () => updateComment(p));
	},
	"review.commentDelete": (params) => {
		const p = params as { workspaceId: string; id: string };
		return withReviewLock(p.workspaceId, async () => {
			deleteComment(p.workspaceId, p.id);
			return { ok: true } as const;
		});
	},
	"review.fileDone": (params) => {
		const p = params as { workspaceId: string; path: string };
		return withReviewLock(p.workspaceId, async () => {
			markFileDone(p.workspaceId, p.path);
			return { ok: true } as const;
		});
	},
	"review.close": (params) => {
		const p = params as { workspaceId: string };
		return withReviewLock(p.workspaceId, async () => {
			clearReview(p.workspaceId);
			return { ok: true } as const;
		});
	},
	"review.sendComment": (params) => {
		const p = params as {
			workspaceId: string;
			id: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
			sessionId?: string;
		};
		return withReviewLock(p.workspaceId, () =>
			sendToFileChat(p.workspaceId, sendableComments(p.workspaceId, [p.id]), p),
		);
	},
	"review.sendBatch": (params) => {
		const p = params as {
			workspaceId: string;
			commentIds?: string[];
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
			sessionId?: string;
		};
		return withReviewLock(p.workspaceId, async () => {
			const comments = sendableComments(p.workspaceId, p.commentIds);
			const groups = new Map<string, typeof comments>();
			for (const comment of comments) {
				const key = reviewSessionKey(comment);
				groups.set(key, [...(groups.get(key) ?? []), comment]);
			}
			const sessions: ReviewSendResult[] = [];
			for (const group of groups.values()) {
				sessions.push(await sendToFileChat(p.workspaceId, group, p));
			}
			if (sessions.length === 0) throw new Error("No draft comments to send.");
			return { sessions };
		});
	},
	"template.list": (params) => {
		const p = params as { workspaceId?: string };
		const dirs = templateDirs(p.workspaceId ? getWorkspace(p.workspaceId).worktreePath : undefined);
		return { templates: listTemplates(dirs) };
	},
	"template.get": (params) => {
		const p = params as { workspaceId?: string; name: string; scope?: TemplateScope };
		const dirs = templateDirs(p.workspaceId ? getWorkspace(p.workspaceId).worktreePath : undefined);
		return getTemplate(dirs, p.name, p.scope);
	},
	"template.save": (params) => {
		const p = params as {
			workspaceId?: string;
			scope: TemplateScope;
			name: string;
			content: string;
		};
		const dirs = templateDirs(p.workspaceId ? getWorkspace(p.workspaceId).worktreePath : undefined);
		return saveTemplate(dirs, p.scope, p.name, p.content);
	},
	"template.delete": (params) => {
		const p = params as { workspaceId?: string; scope: TemplateScope; name: string };
		const dirs = templateDirs(p.workspaceId ? getWorkspace(p.workspaceId).worktreePath : undefined);
		deleteTemplate(dirs, p.scope, p.name);
		return { ok: true } as const;
	},
};

export function requestMethodDiagnostic(method: string): string {
	return Object.hasOwn(handlers, method) ? method : "unknown method";
}

export async function handleRequest(
	method: string,
	params: unknown,
	ctx: RequestContext,
): Promise<unknown> {
	const handler = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params, ctx);
}
