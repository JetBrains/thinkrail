import type {
	AppConfig,
	AskUserQuestionResult,
	CombineMode,
	ExtUiResponse,
	HookName,
	HookSource,
	HookValue,
	ImageContent,
	LoginReply,
	ThinkingLevel,
	WireModel,
	Workspace,
} from "@thinkrail/contracts";
import { WORKSPACE_HOOKS_CONFIG_FILE } from "@thinkrail/shared/paths";
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
	listSessions,
	promptSession,
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
	setProviderApiKey,
	startLogin,
} from "../auth";
import { selectDirectory } from "../dialog";
import { readDir, readFile } from "../fs";
import { gitDiff, gitStatus, listBranches, prefetchBranch } from "../git";
import { githubAuthStatus, githubRefresh } from "../github";
import { loadHookOverrides, saveHookOverrides } from "../persistence";
import {
	closeProject,
	commitProjectFile,
	initProject,
	inspectProjectPath,
	isPathIgnored,
	listProjects,
	openProject,
} from "../projects";
import { updateConfig } from "../settings";
import { evictSpecIndex, projectHasSpecs, specGraph } from "../spec";
import {
	closeTerminal,
	closeWorkspaceTerminals,
	createTerminal,
	resizeTerminal,
	writeTerminal,
} from "../terminal";
import { ensureWatch, stopWatch } from "../watch";
import {
	approveHook,
	createWorkspace,
	forgetWorkspace,
	getWorkspace,
	isApproved,
	listWorkspaces,
	loadHookConfig,
	reclaimWorktree,
	resolveHookRun,
	runOnCreateHook,
	runOnDeleteHook,
	workspaceDiffStats,
	writeHookConfig,
} from "../workspaces";
import { ackSend } from "./ackSend";

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
		await reclaimWorktree(ws);
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
	"workspace.create": (params) => {
		const p = params as {
			projectId: string;
			name?: string;
			baseRef?: string;
			hookCombineMode?: CombineMode;
		};
		return createWorkspace(p.projectId, p.name, p.baseRef, p.hookCombineMode);
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
	// Pre-dates per-source approval and carries no `source` over the wire — so this re-resolves both tiers
	// fresh off disk (never trusts the client's `command` as the material to hash) and approves whichever
	// entry's *current* display matches it. For an inline entry display IS the material; for a `{script}`
	// entry the display is just its label (`script: <path>`) while the material actually hashed is the
	// script's live file contents, read here — so approving a script through this path still content-hashes
	// correctly rather than hashing the label string.
	"workspace.hooks.approve": (params) => {
		const p = params as { projectId: string; hook: HookName; command: string };
		const project = listProjects().find((proj) => proj.id === p.projectId);
		if (!project) throw new Error(`Unknown project: ${p.projectId}`);
		const committed = loadHookConfig(project.path);
		const local = loadHookOverrides()[p.projectId] ?? {};
		const entries = resolveHookRun({
			hook: p.hook,
			committed,
			local,
			mode: "both",
			basePath: project.path,
		});
		for (const entry of entries) {
			if (entry.display === p.command && entry.approvalMaterial != null) {
				approveHook(p.projectId, p.hook, entry.source, entry.approvalMaterial);
			}
		}
		return { ok: true } as const;
	},
	// Re-invoke a specific hook for a specific workspace on demand (the approval flow's "run now" —
	// composed with `workspace.hooks.approve` — and a standalone manual-retry primitive). Only
	// onCreate/onDelete are supported: preMerge/postMerge have no caller anywhere yet, so "run now" has no
	// meaning for them.
	"workspace.hooks.run": (params) => {
		const p = params as { workspaceId: string; hook: HookName };
		const workspace = getWorkspace(p.workspaceId);
		const project = listProjects().find((proj) => proj.id === workspace.projectId);
		if (!project) throw new Error(`Unknown project: ${workspace.projectId}`);
		if (p.hook === "onCreate") runOnCreateHook(workspace, project);
		else if (p.hook === "onDelete") void runOnDeleteHook(workspace, project);
		else throw new Error(`Manual run isn't supported for ${p.hook}`);
		return { ok: true } as const;
	},
	"project.hooks.get": (params) => {
		const p = params as { projectId: string };
		const project = listProjects().find((proj) => proj.id === p.projectId);
		if (!project) throw new Error(`Unknown project: ${p.projectId}`);
		const committed = loadHookConfig(project.path);
		const local = loadHookOverrides()[project.id] ?? {};
		// A project whose `.gitignore` covers `.thinkrail/` can't commit a Shared hook there at all — see
		// `project.hooks.save`, which skips writing Shared rather than force-committing it in that case.
		const sharedCommittable = !isPathIgnored(project.path, WORKSPACE_HOOKS_CONFIG_FILE);
		const hookNames: HookName[] = ["onCreate", "onDelete", "preMerge", "postMerge"];
		const approved: Partial<Record<HookName, Partial<Record<HookSource, boolean>>>> = {};
		for (const hook of hookNames) {
			// mode "both" so BOTH tiers' entries resolve, regardless of the project's actual combine-mode —
			// this map reports every declared entry's approval state, not just the ones that would run.
			const entries = resolveHookRun({
				hook,
				committed,
				local,
				mode: "both",
				basePath: project.path,
			});
			for (const entry of entries) {
				if (entry.approvalMaterial == null) continue; // a missing script has nothing to hash
				approved[hook] = {
					...approved[hook],
					[entry.source]: isApproved(project.id, hook, entry.source, entry.approvalMaterial),
				};
			}
		}
		return {
			combineMode: committed.combineMode,
			shared: committed.hooks,
			local,
			approved,
			sharedCommittable,
		};
	},
	"project.hooks.save": (params) => {
		const p = params as {
			projectId: string;
			combineMode: CombineMode;
			shared: Partial<Record<HookName, HookValue>>;
			local: Partial<Record<HookName, HookValue>>;
		};
		const project = listProjects().find((proj) => proj.id === p.projectId);
		if (!project) throw new Error(`Unknown project: ${p.projectId}`);

		const sharedCommittable = !isPathIgnored(project.path, WORKSPACE_HOOKS_CONFIG_FILE);
		if (Object.keys(p.shared).length > 0 && !sharedCommittable) {
			throw new Error(
				"This project ignores .thinkrail/ — shared hooks can't be committed here. Use a Local hook instead.",
			);
		}
		// Committable: always write+commit, even with an empty `shared` map, so the chosen `combineMode`
		// still persists as the project's default. Not committable: `shared` is already known empty (the
		// guard above threw otherwise), so there's nothing to write — Shared stays unavailable, by design.
		if (sharedCommittable) {
			writeHookConfig(project.path, { version: 1, combineMode: p.combineMode, hooks: p.shared });
			commitProjectFile(project.path, WORKSPACE_HOOKS_CONFIG_FILE, "chore: update workspace hooks");
		}
		saveHookOverrides({ ...loadHookOverrides(), [project.id]: p.local });

		// Approve-on-save (this machine): every entry this save just wrote — Shared (when committable) and
		// Local — is now trusted, so a workspace created right after never sits at `hookAwaitingApproval` for
		// something the user just configured themselves. A script whose file is absent has null material
		// (nothing to hash) and is simply skipped — it approves on its next run instead.
		const hookNames: HookName[] = ["onCreate", "onDelete", "preMerge", "postMerge"];
		for (const hook of hookNames) {
			const entries = resolveHookRun({
				hook,
				committed: { version: 1, combineMode: p.combineMode, hooks: p.shared },
				local: p.local,
				mode: "both",
				basePath: project.path,
			});
			for (const entry of entries) {
				if (entry.approvalMaterial != null) {
					approveHook(project.id, hook, entry.source, entry.approvalMaterial);
				}
			}
		}
		return { ok: true } as const;
	},
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
	"git.status": (params) => {
		const p = params as { workspaceId: string };
		ensureWatch(p.workspaceId);
		return gitStatus(p.workspaceId);
	},
	"git.diff": (params) => {
		const p = params as { workspaceId: string; path?: string };
		ensureWatch(p.workspaceId);
		return gitDiff(p.workspaceId, p.path);
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
	// In-app login. `loginStart` returns its handle at once (the flow runs detached — see `startLogin`);
	// frames stream on the `provider.login` channel, `loginReply` answers a live select/prompt frame.
	"provider.loginStart": (params) => startLogin((params as { providerId: string }).providerId),
	"provider.loginReply": (params) => {
		resolveLogin(params as LoginReply);
		return { ok: true } as const;
	},
	"provider.loginCancel": (params) => {
		cancelLogin((params as { loginId: string }).loginId);
		return { ok: true } as const;
	},
	"provider.setApiKey": (params) => {
		const p = params as { providerId: string; key: string };
		setProviderApiKey(p.providerId, p.key);
		return { ok: true } as const;
	},
	"provider.logout": (params) => {
		logoutProvider((params as { providerId: string }).providerId);
		return { ok: true } as const;
	},
	// JetBrains AI (jbcentral proxy): connect/disconnect write models.json + refresh the registry; login
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
};

/** Route a WS request to its handler. Throws on unknown method (→ a `{ ok:false }` WS response). */
export async function handleRequest(method: string, params: unknown): Promise<unknown> {
	const handler = handlers[method];
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params);
}
