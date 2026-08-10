import type {
	AppConfig,
	AskUserQuestionResult,
	ExtUiResponse,
	GitDiffScope,
	HistoryScope,
	ImageContent,
	LoginReply,
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
	compactSession,
	createSession,
	ensureSessionAttached,
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
	notifyExtUi,
	promptSession,
	refreshAvailableModels,
	reloadSessionResources,
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
} from "../auth";
import { selectDirectory } from "../dialog";
import { listAvailableEditors, openEditor, revealInFileManager } from "../editors";
import { readDir, readFile } from "../fs";
import { gitDiffFile, gitStatus, listBranches, listCommits, prefetchBranch } from "../git";
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
import {
	addComment,
	buildSendPackage,
	closeReview,
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
	resizeTerminal,
	writeTerminal,
} from "../terminal";
import { addTodo, countOpenTodos, listTodos, removeTodo, updateTodo } from "../todos";
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
import { dropLogin, recordLoginStart } from "./loginAnalytics";
import { withReviewLock } from "./reviewLock";

/**
 * Who a request came from. Threaded to every handler so one can scope a resource to its caller; most ignore
 * it, since almost everything the host owns is shared domain state that every client sees identically
 * (architecture #9). Terminals use it for *attachment*, not ownership — a shell belongs to its tab, but only
 * the client currently attached may receive its output or drive it.
 */
export interface RequestContext {
	/** The calling client's id (`?client=` on its socket URL), stable across that client's reconnects. */
	clientKey: string;
}

type Handler = (params: unknown, ctx: RequestContext) => unknown | Promise<unknown>;

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

/**
 * Analytics for a user-authored send, fired only once the send was ACCEPTED (a rejected send throws
 * before this and never counts). Carries just the closed-vocabulary `mode` — nothing about the message,
 * not even its length. Internal control traffic (the client's TODO wake-nudge, marked on the wire) is
 * not a message the user sent, so it is skipped: the `session.*` send methods carry both kinds.
 */
function trackSend(mode: SendMode, text: string): void {
	if (isControlMessage(text)) return;
	track({ name: "message_sent", params: { mode } });
}

/**
 * Fire a review package into its session DETACHED — the send handlers return the moment the session
 * exists, so the client opens the chat tab immediately instead of sitting on pi's turn (`ackSend`'s
 * 10s acceptance window made every review send feel stuck). A pre-turn rejection (bad model, missing
 * API key) can't reach the WS response any more, so it surfaces INSIDE the just-opened chat as an
 * extension-UI notice — AND rolls the comments back from the optimistic `sent` (`markCommentsSent`
 * runs synchronously, before we know the turn is accepted) to `draft` (`rollbackSend`), so a review
 * the agent never received stays retryable instead of stranding as sent with its actions gone. The
 * `ackSend` window is what tells accept from reject: a fault AFTER acceptance is a real turn fault
 * (the package WAS delivered) and rides the event stream, leaving the `sent` state correct.
 */
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
		.catch((err) => {
			// The rollback/notify itself failed — nothing left to do but log; a detached fire has no one
			// to throw to, and letting it surface as an unhandled rejection would be worse.
			console.warn(`review send rollback failed: ${err instanceof Error ? err.message : err}`);
		});
}

/**
 * Send one KEY's comments into a review chat. The landing is, in order: the client's **last open
 * chat** (`opts.sessionId` — the conversation already on the user's screen), else the key's pinned
 * chat (the key is the file path, or the review-level bucket for anchorless remarks, see
 * `reviews.reviewSessionKey`), else a NEW chat (with the review tools every session carries). Whatever
 * receives the package becomes the key's pin (`markCommentsSent`), so the sidebar's "open the
 * discussion" follows the comments. A linked chat that isn't LIVE is not an absent chat: review state
 * and pi transcripts both survive a host restart, so the session is RE-ATTACHED
 * (`ensureSessionAttached`) rather than forked. Only a transcript that is genuinely gone (a purged pi
 * session dir) falls back to a fresh chat — a recovery, not a routine path, so the reason is logged.
 * Every comment handed in must share one key (`sendBatch` groups first). Callers hold the workspace's
 * review lock.
 */
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
		// `reused`: the client must HYDRATE this chat rather than open it as new — it may never have seen
		// it (a second client, or this one after a reload). The model/thinking placeholders match the
		// disk-summary convention and are ignored on that path.
		return {
			sessionId: existing,
			model: null,
			thinkingLevel: "medium" as ThinkingLevel,
			reused: true,
		};
	}
	if (existing) {
		console.warn(
			`review ${workspaceId}: linked chat ${existing} for ${path} is no longer on disk — starting a new review chat`,
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
	"workspace.listExisting": (params) =>
		listExistingWorktrees((params as { projectId: string }).projectId),
	"workspace.openExisting": (params) => {
		const p = params as { projectId: string; path: string };
		return openExistingWorktree(p.projectId, p.path);
	},
	"workspace.list": (params) => listWorkspaces((params as { projectId: string }).projectId),
	"workspace.remove": (params) => {
		const id = (params as { id: string }).id;
		// Non-blocking archive: drop the record now (gone from `workspace.list` immediately) + the fast
		// teardown, ack, then reclaim sessions/worktree in the background so the user never waits for the
		// slow git subprocess + session abort.
		// Everything below keys off the CANONICAL id of a workspace that actually existed — never the
		// raw wire string. `removeWorkspaceReviews` in particular deletes a file derived from the id, so
		// an unchecked id would let a client aim the unlink outside the reviews dir (the persistence
		// helper also refuses path-segment ids — two layers). An unknown id is an idempotent no-op ack.
		const ws = forgetWorkspace(id);
		if (ws) {
			evictSpecIndex(ws.id); // the archived worktree's spec parse cache must not outlive it
			removeWorkspaceReviews(ws.id); // the review file must not outlive its workspace either
			stopWatch(ws.id); // fast: stop the change notifier before the worktree dir is reclaimed
			closeWorkspaceTerminals(ws.id); // fast: kill workspace-scoped PTYs before the dir is reclaimed
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
		// A fetch that moved the local remote-tracking ref may have changed what a sibling workspace's
		// branch-scope diff *means* (its merge-base can move) — and it is invisible to the watch module (it
		// writes only to the shared `.git`, outside every watched location), so this is the one signal those
		// workspaces get; an unaffected re-read is an idempotent no-op. `moved` itself stays host-internal:
		// the wire result remains `{ ok }`.
		if (moved) nudgeBaseRefWorkspaces(p.projectId, p.ref);
		return { ok };
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
	// `scope` selects what is diffed (branch / uncommitted / one commit; omitted = branch). A scope naming a
	// commit that no longer exists rejects — the panel resets its scope on that rejection.
	"git.status": (params) => {
		const p = params as { workspaceId: string; scope?: GitDiffScope };
		ensureWatch(p.workspaceId);
		return gitStatus(p.workspaceId, p.scope);
	},

	"git.diffFile": (params) => {
		const p = params as { workspaceId: string; path: string; scope?: GitDiffScope };
		ensureWatch(p.workspaceId);
		return gitDiffFile(p.workspaceId, p.path, p.scope);
	},
	// The workspace branch's own commits — the scope menu's lazily-fetched commit list.
	"git.listCommits": (params) => listCommits((params as { workspaceId: string }).workspaceId),
	// Every terminal op is scoped to `ctx.clientKey`: a PTY belongs to the client that created it, so another
	// connection can neither read its output nor write to or kill it. An id the caller doesn't own is treated
	// exactly like one that doesn't exist.
	// SYNCHRONOUS ON PURPOSE — see `attachTerminal`. Lookup and insert in one tick is what makes attach atomic
	// on Bun's single event loop, so two concurrent attaches for the same tab cannot both spawn a shell. An
	// `await` anywhere in this path silently reintroduces double-spawn.
	"terminal.attach": (params, ctx) => {
		// Forwarded whole rather than rebuilt: under `exactOptionalPropertyTypes`, an absent `cols` and an
		// explicit `cols: undefined` are different types, and only the former means "use the default".
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
	// Both carry the caller: only the client currently ATTACHED to a terminal may drive it. A displaced client
	// can still hold a valid PTY id, and a reconnect replays its queued frames — without this its keystrokes
	// would land in whoever took the tab over.
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
	// Re-point the workspace's diff target (`null` clears it back to the creation base).
	"workspace.setDiffBase": (params) => {
		const p = params as { id: string; ref: string | null };
		return setWorkspaceDiffBase(p.id, p.ref);
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
		// Chat start is what seeds the gitignored scratch dir — for the Default workspace this is the one
		// moment ThinkRail may write into the user's repo (worktrees self-heal a deleted dir the same way).
		ensureWorkspaceScratchDir(ws);
		const created = await createSession({
			cwd: ws.worktreePath,
			workspaceId: p.workspaceId,
			...(p.model ? { model: p.model } : {}),
			...(p.thinkingLevel ? { thinkingLevel: p.thinkingLevel } : {}),
		});
		// Analytics: a NEW chat only (disk re-opens via session.getMessages never land here). Identity is
		// bucketed against pi's built-in catalog — a custom provider/model name never leaves the process.
		if (created.model) {
			track({
				name: "chat_started",
				params: bucketProviderModel(created.model.provider, created.model.id),
			});
		}
		return created;
	},
	// Sends are acked when ACCEPTED, not when the turn ends — see `ackSend` (a turn can outlive the
	// client's request timeout; long tool rounds are routine).
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
	"session.list": async (params) => {
		const { workspaceId } = params as { workspaceId: string };
		const summaries = await listSessions(workspaceId, getWorkspace(workspaceId).worktreePath);
		// Decorate with each chat's unfinished-TODO count (agent stays todos-free — host composes, the
		// same pattern as history + scope). A single failed count omits the field, never fails the list.
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
	// In-app login (OAuth or interactive API-key entry, per `type`). `loginStart` returns its handle at
	// once (the flow runs detached — see `startLogin`); frames stream on the `provider.login` channel,
	// `loginReply` answers a live select/prompt frame.
	"provider.loginStart": (params) => {
		const p = params as { providerId: string; type?: "oauth" | "api_key" };
		const type = p.type ?? "oauth";
		const handle = startLogin(p.providerId, type);
		// Analytics: remember the flow's method so the login channel's terminal `success` frame can carry
		// it (the tee in `createServer` looks it up — see loginAnalytics.ts).
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
	// JetBrains AI (jbcentral proxy): connect/disconnect write models.json + reload the runtime config; login
	// launches `central login` (browser) on the host.
	"provider.jbcentralConnect": async () => {
		const result = await connectJbcentral();
		// Analytics: only an actual connect counts (needs-install / needs-login / error don't). `jbcentral`
		// is our own constant, not user input — no bucketing needed.
		if (result.outcome === "connected") {
			track({ name: "provider_login", params: { provider: "jbcentral", method: "central" } });
		}
		return result;
	},
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
	// review.* — draft comments on files/diffs → AI sessions (see reviews/SPEC.md). Reads re-anchor
	// server-side; every mutation converges via the `review.changed` push, so handlers just delegate.
	// Every MUTATION runs under the workspace's review lock, sends included: a send's check→mark
	// straddles an await, and a delete/close landing in that gap sends the agent a package for comments
	// no open review contains (see `reviewLock`). The read stays unlocked — it is atomic on its own and
	// hydration must not queue behind a send.
	"review.get": (params) => {
		const p = params as { workspaceId: string };
		ensureWatch(p.workspaceId);
		return getReviewSnapshot(p.workspaceId);
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
			closeReview(p.workspaceId);
			return { ok: true } as const;
		});
	},
	// Send ONE comment — into its FILE's review chat (created on the file's first send, followed up
	// after). Serialized per workspace: check-and-mark straddles an await, so a concurrent send would
	// double-spawn and a concurrent delete/close would strand the package (see `reviewLock`).
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
	// Send all/selected drafts as one batch, grouped by review key (file path, or the review-level
	// bucket): each group lands in its own chat. **Every session it touched comes back**, in group order
	// — a batch spanning two files starts two chats, and returning only the first left the user with a
	// chat they never saw for comments already marked sent. (The Send-review button is per-file, so a
	// multi-group batch is a wire-only case today.) Serialized per workspace like `review.sendComment`:
	// without it two concurrent "Send review" clicks both read the file's session as unset and each
	// create their own.
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
export async function handleRequest(
	method: string,
	params: unknown,
	ctx: RequestContext,
): Promise<unknown> {
	const handler = handlers[method];
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params, ctx);
}
