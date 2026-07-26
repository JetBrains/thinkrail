import type {
	AppConfig,
	AskUserQuestionResult,
	ExtUiResponse,
	HistoryScope,
	ImageContent,
	LoginReply,
	TemplateScope,
	ThinkingLevel,
	TodoStatus,
	WireModel,
	Workspace,
} from "@thinkrail/contracts";
import {
	abortSession,
	answerQuestion,
	compactSession,
	createSession,
	followUpSession,
	getDefaultModel,
	getSessionCommands,
	getSessionMessages,
	getSessionStats,
	hasSession,
	listAvailableModels,
	listProjectAliasSkillNames,
	listSessions,
	listSkillCatalog,
	listSkillCommands,
	promptSession,
	reloadSessionResources,
	removeSession,
	removeWorkspaceSessions,
	resolveExtUi,
	setSessionModel,
	setSessionThinkingLevel,
	steerSession,
} from "../agent";
import {
	cancelLogin,
	connectJbcentral,
	disconnectJbcentral,
	getProviderStatus,
	jbcentralLogin,
	logoutProvider,
	resolveLogin,
	startLogin,
} from "../auth";
import { selectDirectory } from "../dialog";
import { readDir, readFile } from "../fs";
import { gitDiffFile, gitStatus, listBranches, prefetchBranch } from "../git";
import { githubAuthStatus, githubRefresh } from "../github";
import { clampLimit, getHistoryIndex } from "../history";
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
	closeTerminal,
	closeWorkspaceTerminals,
	createTerminal,
	resizeTerminal,
	writeTerminal,
} from "../terminal";
import { addTodo, listTodos, removeTodo, updateTodo } from "../todos";
import { ensureWatch, stopWatch } from "../watch";
import {
	createWorkspace,
	forgetWorkspace,
	getWorkspace,
	listWorkspaceRecords,
	listWorkspaces,
	reclaimWorktree,
	setWorkspaceSkillOverride,
	workspaceDiffStats,
} from "../workspaces";
import { ackSend } from "./ackSend";
import { buildHistoryScope } from "./historyScope";

type Handler = (params: unknown) => unknown | Promise<unknown>;

/**
 * The slow half of archiving a workspace, run in the background after `workspace.remove` acks: tear down
 * the workspace's sessions (abort a streaming turn, dispose, purge on-disk transcripts) then reclaim the
 * worktree (`git worktree remove`). Sessions/terminals are down before the dir is deleted (terminals are
 * killed synchronously in the handler; sessions here, before the reclaim). Best-effort by contract — a
 * failure is logged, never thrown into the void (nothing awaits it).
 */
async function archiveTeardown(ws: Workspace): Promise<void> {
	try {
		await removeWorkspaceSessions(ws.id, ws.worktreePath);
		reclaimWorktree(ws);
	} catch (error) {
		console.warn(`workspace archive teardown failed for ${ws.id}: ${error}`);
	}
}

const handlers: Record<string, Handler> = {
	"project.open": (params) => openProject((params as { path: string }).path),
	"project.inspect": (params) => inspectProjectPath((params as { path: string }).path),
	"project.init": (params) => initProject((params as { path: string }).path),
	"project.list": () => listProjects(),
	// Lazy, per-project: the Welcome screen requests this only for the one project it renders, so the
	// full-tree spec walk never sits on the connect handshake (which fans out over every project).
	"project.hasSpecs": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((p) => p.id === projectId);
		return { hasSpecs: project ? projectHasSpecs(project.path) : false };
	},
	"project.close": (params) => {
		closeProject((params as { id: string }).id);
		return { ok: true } as const;
	},
	// Persist the user's trust grant → gates the repo's committed cross-agent skill aliases. Granting
	// acknowledges the skills present *now*, so a skill that appears later (a pull / branch) stays gated
	// until separately confirmed. Returns the updated project so the client refreshes its store.
	"project.setTrust": async (params) => {
		const p = params as { id: string; trusted: boolean };
		const project = listProjects().find((candidate) => candidate.id === p.id);
		if (!project) throw new Error(`Unknown project: ${p.id}`);
		const acknowledged = p.trusted ? await listProjectAliasSkillNames(project.path) : undefined;
		return setProjectTrust(p.id, p.trusted, acknowledged);
	},
	"workspace.create": (params) => {
		const p = params as { projectId: string; name?: string; baseRef?: string };
		return createWorkspace(p.projectId, p.name, p.baseRef);
	},
	"workspace.list": (params) => listWorkspaces((params as { projectId: string }).projectId),
	"workspace.remove": (params) => {
		const id = (params as { id: string }).id;
		// Non-blocking archive: drop the record now (gone from `workspace.list` immediately) + the fast
		// teardown, ack, then reclaim sessions/worktree in the background so the user never waits for the
		// slow git subprocess + session abort.
		const ws = forgetWorkspace(id);
		evictSpecIndex(id); // the archived worktree's spec parse cache must not outlive it
		stopWatch(id); // fast: stop the change notifier before the worktree dir is reclaimed
		closeWorkspaceTerminals(id); // fast: kill workspace-scoped PTYs before the dir is reclaimed
		if (ws) void archiveTeardown(ws);
		return { ok: true } as const;
	},
	"workspace.diffStats": (params) => workspaceDiffStats((params as { id: string }).id),
	"git.listBranches": (params) => listBranches((params as { projectId: string }).projectId),
	"git.prefetch": (params) => {
		const p = params as { projectId: string; ref: string };
		return prefetchBranch(p.projectId, p.ref);
	},
	"github.authStatus": () => githubAuthStatus(),
	"github.refresh": () => githubRefresh(),
	"dialog.selectDirectory": () => selectDirectory(),
	// Workspace reads double as the change-notifier trigger: a read means "a client is looking at this
	// worktree", so the host lazily starts its watcher (idempotent; unknown ids no-op, the read throws).
	"fs.readDir": (params) => {
		const p = params as { workspaceId: string; path: string };
		ensureWatch(p.workspaceId);
		return readDir(p.workspaceId, p.path);
	},
	"fs.readFile": (params) => {
		const p = params as { workspaceId: string; path: string };
		ensureWatch(p.workspaceId);
		return readFile(p.workspaceId, p.path);
	},
	"spec.graph": (params) => {
		const p = params as { workspaceId: string };
		ensureWatch(p.workspaceId);
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
	"todo.remove": (params) =>
		removeTodo(params as { workspaceId: string; sessionId: string; id: string }),
	"git.status": (params) => {
		const p = params as { workspaceId: string };
		ensureWatch(p.workspaceId);
		return gitStatus(p.workspaceId);
	},
	"git.diffFile": (params) => {
		const p = params as { workspaceId: string; path: string };
		ensureWatch(p.workspaceId);
		return gitDiffFile(p.workspaceId, p.path);
	},
	"terminal.create": (params) => createTerminal((params as { workspaceId: string }).workspaceId),
	"terminal.write": (params) => {
		const p = params as { id: string; data: string };
		writeTerminal(p.id, p.data);
		return { ok: true } as const;
	},
	"terminal.resize": (params) => {
		const p = params as { id: string; cols: number; rows: number };
		resizeTerminal(p.id, p.cols, p.rows);
		return { ok: true } as const;
	},
	"terminal.close": (params) => {
		closeTerminal((params as { id: string }).id);
		return { ok: true } as const;
	},
	"skill.list": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((candidate) => candidate.id === projectId);
		if (!project) throw new Error(`Unknown project: ${projectId}`);
		// Same admission gate the live session uses, minus per-workspace overrides (none pre-session).
		return listSkillCommands(project.path, {
			trusted: project.trusted === true,
			acknowledged: project.acknowledgedSkills ?? [],
			disabled: project.disabledSkills ?? [],
			disabledGroups: project.disabledGroups ?? [],
			overrides: {},
		});
	},
	// The workspace Skills manager: the full catalog + each skill's admission verdict, resolved against the
	// worktree's checkout and the owning project's trust/toggles plus this workspace's overrides.
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
	// Confirm project-scoped skills that appeared after trust (re-confirm-new) — echoes the updated Project.
	"project.acknowledgeSkills": (params) => {
		const p = params as { id: string; names: string[] };
		return acknowledgeProjectSkills(p.id, p.names);
	},
	// Project-baseline per-skill enable/disable.
	"project.setSkillEnabled": (params) => {
		const p = params as { id: string; name: string; enabled: boolean };
		return setProjectSkillEnabled(p.id, p.name, p.enabled);
	},
	// Present committed alias skill names in the project's checkout — the count behind the trust notice.
	"project.aliasSkills": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((p) => p.id === projectId);
		if (!project) throw new Error(`Unknown project: ${projectId}`);
		return listProjectAliasSkillNames(project.path);
	},
	// Turn a group (plugin / source tier / `@plugins`) on/off at the project baseline.
	"project.setGroupEnabled": (params) => {
		const p = params as { id: string; group: string; enabled: boolean };
		return setProjectGroupEnabled(p.id, p.group, p.enabled);
	},
	// Project-scoped catalog for the pre-session manager (current checkout, no per-workspace overrides).
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
	// Per-workspace per-skill override over the project baseline (`null` clears it).
	"workspace.setSkillOverride": (params) => {
		const p = params as { id: string; name: string; override: "on" | "off" | null };
		return setWorkspaceSkillOverride(p.id, p.name, p.override);
	},
	// Apply skill/settings changes to a running session (active-chat reload); rejects while streaming.
	"session.reloadResources": async (params) => {
		await reloadSessionResources((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	// session.* — the pi engine. A thrown/failed call returns a `{ ok:false, error }` WS response;
	// streaming faults arrive as `pi.event`s (the error/agent_end variants), not here.
	"session.create": async (params) => {
		const p = params as {
			workspaceId: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
		};
		const ws = getWorkspace(p.workspaceId);
		return createSession({
			cwd: ws.worktreePath,
			workspaceId: p.workspaceId,
			...(p.model ? { model: p.model } : {}),
			...(p.thinkingLevel ? { thinkingLevel: p.thinkingLevel } : {}),
		});
	},
	// Sends are acked when ACCEPTED, not when the turn ends — see `ackSend` (a turn can outlive the
	// client's request timeout; long tool rounds are routine).
	"session.prompt": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(promptSession(p.sessionId, p.text, p.images));
		return { ok: true } as const;
	},
	"session.steer": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(steerSession(p.sessionId, p.text, p.images));
		return { ok: true } as const;
	},
	"session.followUp": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(followUpSession(p.sessionId, p.text, p.images));
		return { ok: true } as const;
	},
	"session.abort": async (params) => {
		await abortSession((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	"session.dispose": (params) => {
		removeSession((params as { sessionId: string }).sessionId);
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
	"session.compact": (params) => {
		const p = params as { sessionId: string; instructions?: string };
		compactSession(p.sessionId, p.instructions);
		return { ok: true } as const;
	},
	"session.getStats": (params) => getSessionStats((params as { sessionId: string }).sessionId),
	"session.getCommands": (params) =>
		getSessionCommands((params as { sessionId: string }).sessionId),
	"session.list": (params) => {
		const { workspaceId } = params as { workspaceId: string };
		return listSessions(workspaceId, getWorkspace(workspaceId).worktreePath);
	},
	"session.getMessages": (params) => {
		const p = params as { sessionId: string; workspaceId: string };
		return getSessionMessages(p.sessionId, p.workspaceId, getWorkspace(p.workspaceId).worktreePath);
	},
	"session.extUiReply": (params) => {
		resolveExtUi((params as { response: ExtUiResponse }).response);
		return { ok: true } as const;
	},
	"session.answerQuestion": async (params) => {
		const p = params as { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		// Reply-style method: vet the shape and the target up front — a disposed/unknown session or a
		// non-awaiting tool call (already answered / superseded / legacy-resolved) fails the request loud;
		// nothing is ever parked. Delivery starts the answer TURN, so like prompt/steer/followUp it's acked
		// when accepted (`ackSend`), and later faults arrive via the event stream.
		if (!hasSession(p.sessionId)) throw new Error(`Unknown session: ${p.sessionId}`);
		if (!p.result || !Array.isArray(p.result.answers) || typeof p.result.cancelled !== "boolean")
			throw new Error("Malformed ask_user_question result");
		await ackSend(answerQuestion(p.sessionId, p.toolCallId, p.result));
		return { ok: true } as const;
	},
	"model.list": () => listAvailableModels(),
	"model.default": () => getDefaultModel(),
	"provider.status": () => getProviderStatus(),
	// In-app login (OAuth or interactive API-key entry, per `type`). `loginStart` returns its handle at
	// once (the flow runs detached — see `startLogin`); frames stream on the `provider.login` channel,
	// `loginReply` answers a live select/prompt frame.
	"provider.loginStart": (params) => {
		const p = params as { providerId: string; type?: "oauth" | "api_key" };
		return startLogin(p.providerId, p.type ?? "oauth");
	},
	"provider.loginReply": (params) => {
		resolveLogin(params as LoginReply);
		return { ok: true } as const;
	},
	"provider.loginCancel": (params) => {
		cancelLogin((params as { loginId: string }).loginId);
		return { ok: true } as const;
	},
	"provider.logout": async (params) => {
		await logoutProvider((params as { providerId: string }).providerId);
		return { ok: true } as const;
	},
	// JetBrains AI (jbcentral proxy): connect/disconnect write models.json + reload the runtime config; login
	// launches `central login` (browser) on the host.
	"provider.jbcentralConnect": () => connectJbcentral(),
	"provider.jbcentralDisconnect": async () => {
		await disconnectJbcentral();
		return { ok: true } as const;
	},
	"provider.jbcentralLogin": () => jbcentralLogin(),
	// Merge + persist a partial into the server-synced app config (theme, …); the broadcast is fired by
	// `updateConfig`'s injected publisher (wired in `createServer`), so every client converges.
	"settings.update": (params) => updateConfig((params as { config: Partial<AppConfig> }).config),
	// Prompt recall + conversation search over pi's session files. Scope mapping is resolved here (host
	// owns the registries); the index itself stays registry-free (see history/SPEC.md).
	// Uses listWorkspaceRecords (diffStats-free registry read) to avoid blocking on git per keystroke.
	"history.search": (params) => {
		const p = params as { query: string; scope: HistoryScope; limit?: number };
		const { filter, labels } = buildHistoryScope(p.scope, listProjects(), (projectId) =>
			listWorkspaceRecords(projectId),
		);
		// Clamp the client-controlled limit at the boundary (defense in depth; `search()` clamps too).
		return getHistoryIndex().search({
			query: p.query,
			filter,
			labels,
			limit: clampLimit(p.limit),
		});
	},
	// Prompt-template CRUD: list/read/write/delete pi's global + project-scoped templates. The
	// template.* handlers resolve workspaceId → cwd via getWorkspace, then delegate to the templates
	// module (which stays registry-free: it only takes a cwd, never a workspaceId).
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

/** Route a WS request to its handler. Throws on unknown method (→ a `{ ok:false }` WS response). */
export async function handleRequest(method: string, params: unknown): Promise<unknown> {
	const handler = handlers[method];
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params);
}
