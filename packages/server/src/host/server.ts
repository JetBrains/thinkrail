import { createHash, randomUUID } from "node:crypto";
import { join, normalize } from "node:path";
import type {
	ServerWelcome,
	SessionDeletedPayload,
	TerminalTabsPush,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import {
	disposeAllSessions,
	getSessionWorkspaceId,
	isProjectSkillPath,
	setExtUiPublisher,
	setReviewCommentHandler,
	setSessionDeletedPublisher,
	setSessionPublisher,
	setSkillAdmissionResolver,
} from "../agent";
import {
	type AnalyticsOptions,
	initializeAnalytics,
	setAnalyticsSending,
	shutdownAnalytics,
} from "../analytics";
import { cancelAllLogins, setLoginPublisher } from "../auth";
import { resolveWorktreeFile } from "../fs";
import {
	getProjects,
	listProjects,
	listRecentProjects,
	openProject,
	setProjectPublisher,
} from "../projects";
import { reanchorWorkspace, resolveCommentFromAgent, setReviewPublisher } from "../reviews";
import { getConfig, setSettingsPublisher } from "../settings";
import {
	closeAllTerminals,
	persistTerminalSessions,
	resumeClientTerminals,
	reviveTerminalSessions,
	setTerminalPublisher,
	setTerminalTabsPublisher,
} from "../terminal";
import {
	setRepoMetaPublisher,
	setSkillPathClassifier,
	setWatchPublisher,
	stopAllWatches,
} from "../watch";
import { getWorkspace, refreshUserOwnedWorkspace, setWorkspacePublisher } from "../workspaces";
import {
	isPromptCommitted,
	isSettledTurn,
	maybeAutoRenameWorkspace,
	maybeNaiveNameWorkspace,
} from "./autoRename";
import { setFsNudgePublisher } from "./fsNudge";
import { handleRequest } from "./handlers";
import { trackLoginOutcome } from "./loginAnalytics";
import { RequestReplayCache } from "./requestReplayCache";
import { terminalDeliveryForSendStatus } from "./terminalSend";

export interface CreateServerOptions {
	port?: number;
	host?: string;
	/** When set, serve the built web app (SPA) from this directory. */
	staticDir?: string;
	/** When set, open this git repo as a project on boot (best-effort — a launcher convenience). */
	projectPath?: string;
	/** The launcher's baked release version, echoed in the `server.welcome` push (undefined from source). */
	appVersion?: string;
	/**
	 * Anonymous-analytics wiring from the launcher: the release channel + how this process was produced
	 * (`build`) + the `--no-analytics` per-run mute. Every channel sends; muting is the analytics
	 * service's own decision (CI / `NODE_ENV=test` / `THINKRAIL_NO_ANALYTICS`), so a launcher that passes
	 * nothing still gets the right behaviour.
	 */
	analytics?: Pick<
		AnalyticsOptions,
		"channel" | "build" | "posthogApiKey" | "posthogHost" | "mute"
	>;
}

export interface RunningServer {
	readonly port: number;
	stop: () => void;
}

/** Per-socket state carried through the upgrade — see the `?client=` note in `fetch`. */
interface SocketData {
	clientKey: string;
}

/**
 * How long a vanished client's retained request results are kept before its namespace is retired.
 *
 * This no longer touches terminals. Shells are owner-scoped and reference-counted by the host-owned tab list
 * (see `submodule-server-terminal`): a shell dies when its tab is closed, its workspace is archived, it exits,
 * or the host stops — never because a browser went away. Killing on client disappearance was what made a
 * reload destroy your work, and reference-based GC makes it redundant besides.
 *
 * What still needs retiring is the exactly-once replay cache, which is per client and would otherwise retain a
 * page's responses forever. The client reconnects on its own with backoff, so this only has to outlast a
 * realistic reconnect.
 */
const CLIENT_REPLAY_RETENTION_MS = 60_000;

/** Ids arrive from the wire, so an `ack`/`resume` list is filtered rather than trusted to hold strings. */
const isRequestId = (id: unknown): id is string => typeof id === "string";

/** Boot the engine host: Bun.serve HTTP+WS, /health, optional static SPA, and the server.welcome push. */
export function createServer(options: CreateServerOptions = {}): RunningServer {
	const {
		port = 24242,
		host = "localhost",
		staticDir,
		projectPath,
		appVersion,
		analytics,
	} = options;

	/** The live socket per client id. One entry per connected page; a reconnect replaces its own entry. */
	const sockets = new Map<string, Bun.ServerWebSocket<SocketData>>();
	/** Pending "this client looks gone, retire its replay namespace" timers, cancelled if it reconnects. */
	const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Exactly-once handler results for unresolved requests replayed by a reconnecting page. */
	const requestReplays = new RequestReplayCache<string>();
	/** Clients whose last accepted terminal frame filled Bun's socket buffer; cleared only by drain/reconnect. */
	const terminalBackpressured = new Set<string>();
	/**
	 * Set by `stop()` before it closes the socket. `server.stop(true)` fires every `close(ws)` synchronously, so
	 * without this the shutdown path armed a fresh 60s reap timer per connected client *after* clearing them —
	 * leaving timers holding the event loop open and contradicting stop()'s own claim of symmetric teardown.
	 */
	let stopping = false;

	/**
	 * Arm the window after which a client with no socket counts as gone and its replay namespace is retired.
	 *
	 * Re-arms itself while `clearClient` declines — a request still in flight means the page can come back and
	 * replay exactly that id, and forgetting the entry would run its handler a second time (see
	 * `requestReplayCache`). It ends when that last handler settles, on a reconnect (`open` cancels the timer
	 * and the namespace stands), or at `stop()`, which clears them all.
	 */
	const armClientReap = (clientKey: string): void => {
		reapTimers.set(
			clientKey,
			setTimeout(() => {
				reapTimers.delete(clientKey);
				if (sockets.has(clientKey)) return;
				if (!requestReplays.clearClient(clientKey)) armClientReap(clientKey);
			}, CLIENT_REPLAY_RETENTION_MS),
		);
	};

	const server = Bun.serve<SocketData, never>({
		port,
		hostname: host,
		async fetch(req, srv) {
			const url = new URL(req.url);
			if (url.pathname === "/ws") {
				// `?client=` identifies the *page*, not the socket: it survives that client's reconnects and is
				// new on every reload, which is what lets a PTY outlive a dropped connection (the client
				// reconnects on its own) without outliving the document that owns it. A client that sends none
				// gets a per-socket fallback — correct isolation, just no reconnect grace.
				const clientKey = url.searchParams.get("client") ?? `anon-${randomUUID()}`;
				return srv.upgrade(req, { data: { clientKey } })
					? undefined
					: new Response("ws upgrade failed", { status: 400 });
			}
			if (url.pathname === "/health") {
				return new Response("ok");
			}
			if (url.pathname.startsWith("/files/")) {
				return serveWorktreeFile(url.pathname);
			}
			if (staticDir) {
				return serveStatic(url.pathname, staticDir);
			}
			return new Response("not found", { status: 404 });
		},
		websocket: {
			open(ws) {
				const replaced = sockets.get(ws.data.clientKey);
				sockets.set(ws.data.clientKey, ws);
				// A page identity has one live wire. Closing the replaced socket after registering its successor
				// prevents duplicate broadcast subscriptions; its close handler sees the successor and reaps nothing.
				if (replaced && replaced !== ws) replaced.close();
				terminalBackpressured.delete(ws.data.clientKey);
				// Reconnected inside the grace window — this client never really left, so its PTYs stand.
				const pendingReap = reapTimers.get(ws.data.clientKey);
				if (pendingReap !== undefined) {
					clearTimeout(pendingReap);
					reapTimers.delete(ws.data.clientKey);
				}
				// Deliberately NO `terminal.data` subscription: terminal frames are addressed to the one client
				// that owns the PTY (see `setTerminalPublisher` below), never published to a topic every socket
				// listens on.
				ws.subscribe(WS_CHANNELS.piEvent);
				ws.subscribe(WS_CHANNELS.piExtensionUi);
				ws.subscribe(WS_CHANNELS.sessionDeleted);
				ws.subscribe(WS_CHANNELS.providerLogin);
				ws.subscribe(WS_CHANNELS.projectUpdated);
				ws.subscribe(WS_CHANNELS.terminalTabs);
				ws.subscribe(WS_CHANNELS.workspaceCreated);
				ws.subscribe(WS_CHANNELS.workspaceUpdated);
				ws.subscribe(WS_CHANNELS.workspaceRemoved);
				ws.subscribe(WS_CHANNELS.workspaceFsChanged);
				ws.subscribe(WS_CHANNELS.settingsChanged);
				ws.subscribe(WS_CHANNELS.reviewChanged);
				const welcome: ServerWelcome = {
					protocolVersion: PROTOCOL_VERSION,
					projects: listProjects(),
					recentProjects: listRecentProjects(),
					config: getConfig(),
					...(appVersion ? { appVersion } : {}),
				};
				const welcomeStatus = ws.send(
					JSON.stringify({ channel: WS_CHANNELS.serverWelcome, data: welcome }),
				);
				const welcomeDelivery = terminalDeliveryForSendStatus(welcomeStatus);
				if (welcomeDelivery === "unavailable") {
					// A page cannot safely operate without its protocol handshake; reconnect and resend it.
					ws.close();
					return;
				}
				if (welcomeDelivery === "backpressured") {
					terminalBackpressured.add(ws.data.clientKey);
				}
				// The handshake is ahead of any retained terminal bytes. If it filled the socket buffer, resume
				// sees the blocked client and leaves those bytes held until drain.
				resumeClientTerminals(ws.data.clientKey);
			},
			async message(ws, message) {
				const raw = typeof message === "string" ? message : message.toString();
				let req: unknown;
				try {
					req = JSON.parse(raw);
				} catch {
					return;
				}
				if (typeof req !== "object" || req === null) return;
				// A receipt, not a request: the client naming responses it has read. That is the host's only
				// proof they were not lost with a socket, so it frees those retained results — and runs nothing.
				if ("ack" in req && Array.isArray(req.ack)) {
					requestReplays.acknowledge(ws.data.clientKey, req.ack.filter(isRequestId));
					return;
				}
				// The reconnect reconciliation, sent ahead of the replays: everything this page may still replay.
				// It repairs receipts that died with the previous socket, so a lost one costs a retained result
				// until the next connect rather than until the page retires.
				if ("resume" in req && Array.isArray(req.resume)) {
					requestReplays.retain(ws.data.clientKey, req.resume.filter(isRequestId));
					return;
				}
				if (
					!("id" in req) ||
					typeof req.id !== "string" ||
					!("method" in req) ||
					typeof req.method !== "string"
				) {
					return;
				}
				const requestId = req.id;
				const method = req.method;
				const params = "params" in req ? req.params : undefined;
				const sessionId = "sessionId" in req ? req.sessionId : undefined;
				// Keep the replay cache bounded by results, not by a second retained copy of potentially-large
				// params (file/template writes). The same replayed frame hashes identically.
				const fingerprint = createHash("sha256")
					.update(JSON.stringify([method, params, sessionId ?? null]))
					.digest("hex");
				try {
					const response = await requestReplays.run(
						ws.data.clientKey,
						requestId,
						fingerprint,
						async () => {
							try {
								const result = await handleRequest(method, params, {
									clientKey: ws.data.clientKey,
								});
								return JSON.stringify({ id: requestId, ok: true, result });
							} catch (err) {
								const error = err instanceof Error ? err.message : String(err);
								// A failure the host can *name* travels as a code too (`CodedError`), so a client can
								// react to this error specifically instead of pattern-matching a message.
								const code = errorCodeOf(err);
								return JSON.stringify({
									id: requestId,
									ok: false,
									error,
									...(code ? { errorCode: code } : {}),
								});
							}
						},
					);
					// A zero means Bun dropped the reply. Closing makes the unresolved client replay this id; the
					// cache above returns `response` without executing the handler again.
					if (ws.send(response) === 0) ws.close();
				} catch (err) {
					// Cache-level refusals — an id replayed with a different payload, a new id arriving at a full
					// namespace, or a replay whose response was too large to retain. Each answers with an error precisely
					// so it does not rerun, displace, or crowd out the operations already stored for this client.
					const error = err instanceof Error ? err.message : String(err);
					if (ws.send(JSON.stringify({ id: requestId, ok: false, error })) === 0) ws.close();
				}
			},
			drain(ws) {
				// An old replaced socket must not mark its successor writable.
				if (sockets.get(ws.data.clientKey) !== ws) return;
				terminalBackpressured.delete(ws.data.clientKey);
				resumeClientTerminals(ws.data.clientKey);
			},
			close(ws) {
				if (stopping) return; // shutting down: stop() clears every namespace, no retiring needed
				const { clientKey } = ws.data;
				// Only forget the socket if it is still the current one: a fast reconnect can register the new
				// socket before the old one's close fires, and clearing then would orphan a live connection.
				if (sockets.get(clientKey) === ws) {
					sockets.delete(clientKey);
					terminalBackpressured.delete(clientKey);
				}
				// Terminals are deliberately untouched. A shell belongs to its tab, not to whoever was looking at
				// it, so a closed browser leaves every shell running — that is what makes a reload non-destructive.
				if (sockets.has(clientKey) || reapTimers.has(clientKey)) return;
				armClientReap(clientKey);
			},
		},
	});

	// Terminal frames go to the ONE client that owns the PTY, addressed by client id rather than published to a
	// topic — see the `terminalData` note in the wire. Once Bun reports backpressure, no terminal gets another
	// send attempt for that client until drain/reconnect; each batcher retains its own bounded tail meanwhile.
	setTerminalPublisher((clientKey, channel, data) => {
		if (terminalBackpressured.has(clientKey)) return "unavailable";
		const ws = sockets.get(clientKey);
		if (!ws) return "unavailable";
		try {
			const delivery = terminalDeliveryForSendStatus(ws.send(JSON.stringify({ channel, data })));
			if (delivery !== "delivered") terminalBackpressured.add(clientKey);
			return delivery;
		} catch {
			terminalBackpressured.add(clientKey);
			ws.close();
			return "unavailable";
		}
	});

	// Resolve a session's skill-admission context: map the workspace it belongs to back to its project's
	// persisted trust + acknowledged set + baseline disables, plus that workspace's per-skill overrides.
	// Fail closed on any lookup miss, so a stale/unknown id never loads an untrusted repo's skills.
	setSkillAdmissionResolver((workspaceId) => {
		try {
			const { projectId, skillOverrides } = getWorkspace(workspaceId);
			const project = getProjects().find((p) => p.id === projectId);
			return {
				trusted: project?.trusted === true,
				acknowledged: project?.acknowledgedSkills ?? [],
				disabled: project?.disabledSkills ?? [],
				disabledGroups: project?.disabledGroups ?? [],
				overrides: skillOverrides ?? {},
			};
		} catch {
			return { trusted: false, acknowledged: [], disabled: [], disabledGroups: [], overrides: {} };
		}
	});

	// Fan authoritative project open/reopen/close snapshots out to every client. One full-snapshot
	// channel is idempotent: Project.closed tells each store whether to upsert or remove the rail row.
	setProjectPublisher((project) => {
		server.publish(
			WS_CHANNELS.projectUpdated,
			JSON.stringify({ channel: WS_CHANNELS.projectUpdated, data: project }),
		);
	});

	// Fan the `workspaces` module's lifecycle events out to every subscribed client, mapping each domain
	// `kind` to its `workspace.*` channel (the module stays channel-ignorant). `created`/`updated` send the
	// full record snapshot (idempotent under the store's fold-by-id, so the auto-rename's naive-then-agentic
	// pair is two updates, last wins); `removed` sends the `{ projectId, id }` pair. Every client — including
	// the initiator — converges by reacting to these, never a per-client optimistic mutation.
	// Which terminals exist is shared domain state, so tab-list changes are BROADCAST (the workspace-trio
	// pattern) even though a shell's contents are addressed to the one attached client. An idempotent snapshot
	// per workspace: folding it twice is harmless, and a client that missed one converges on the next.
	setTerminalTabsPublisher((workspaceId, tabs) => {
		const data: TerminalTabsPush = { workspaceId, tabs };
		server.publish(
			WS_CHANNELS.terminalTabs,
			JSON.stringify({ channel: WS_CHANNELS.terminalTabs, data }),
		);
	});

	setWorkspacePublisher((event) => {
		const channel =
			event.kind === "created"
				? WS_CHANNELS.workspaceCreated
				: event.kind === "updated"
					? WS_CHANNELS.workspaceUpdated
					: WS_CHANNELS.workspaceRemoved;
		const data =
			event.kind === "removed" ? { projectId: event.projectId, id: event.id } : event.workspace;
		server.publish(channel, JSON.stringify({ channel, data }));
	});

	// Push the worktree change notifier's debounced invalidation batches (agent edits, terminal
	// commands, Finder) to every subscribed client — receivers re-read via the normal read methods.
	// The reviews tee rides the same signal (host-mediated — `watch` has no `reviews` edge): a worktree
	// change re-anchors the workspace's open review comments, which self-publishes `review.changed`
	// only when an anchor actually moved. Cheap: a workspace with no review file is a no-op.
	const publishFsChanged = (payload: WorkspaceFsChangedPayload) => {
		server.publish(
			WS_CHANNELS.workspaceFsChanged,
			JSON.stringify({ channel: WS_CHANNELS.workspaceFsChanged, data: payload }),
		);
		reanchorWorkspace(payload.workspaceId);
	};
	setWatchPublisher(publishFsChanged);
	setSkillPathClassifier(isProjectSkillPath);
	// The same frame, publishable from the `git.prefetch` handler: the app's own background fetch moves
	// `refs/remotes/…` in the project repo's shared `.git` — a location no worktree watcher can see — so the
	// handler nudges the workspaces whose diff base that ref is (see `fsNudge.ts`).
	setFsNudgePublisher(publishFsChanged);

	// The notifier's second seam, host-mediated (`watch` has no `workspaces` edge): a git-metadata write in
	// a watched worktree — a `git switch`/`commit`/`reset` in its terminal — converges two things that a
	// file watcher alone cannot see, because such a change can leave the working tree byte-identical and
	// produce no `fsChanged` batch at all:
	//   1. a user-owned **Default/external** workspace's folder-truth branch (rail, top bar, receipt)
	//      instead of only at the next `workspace.list`; self-publishing (`refreshUserOwnedWorkspace` emits
	//      `workspace.updated` through the lifecycle tee above), and a no-op for managed worktrees;
	//   2. every **git-derived read** on the clients — `git.status` and an open `uncommitted`-scope diff tab
	//      are relative to `HEAD`, so a commit made in a terminal would otherwise keep being reported as
	//      uncommitted until some later file edit. Emitted as a **pathless** `fsChanged` nudge (no paths, not
	//      truncated): the frame is an invalidation, and a ref move invalidates exactly these reads without
	//      naming any file — so no `.git` path leaks to a client, and path-driven consumers (the Skills-reload
	//      badge) correctly see nothing of interest.
	setRepoMetaPublisher((workspaceId) => {
		refreshUserOwnedWorkspace(workspaceId);
		publishFsChanged({ workspaceId, paths: [], truncated: false, skillChange: "none" });
	});

	// Fan `review.changed` snapshots out to every client (the reviews module stays channel-ignorant),
	// and wire the agent-side `resolve_comment` tool's execution back into the review store — the seam
	// pair that keeps `reviews` and `agent` decoupled (see reviews/SPEC.md).
	setReviewPublisher((payload) => {
		server.publish(
			WS_CHANNELS.reviewChanged,
			JSON.stringify({ channel: WS_CHANNELS.reviewChanged, data: payload }),
		);
	});
	setReviewCommentHandler((commentId, note) => ({
		resolvedBody: resolveCommentFromAgent(commentId, note).body,
	}));

	// Broadcast a server-synced settings change (the full `AppConfig`) to every client so they converge —
	// the initiator applies on this push too, never optimistically (the workspace-lifecycle pattern). The
	// analytics service syncs off the same tee (host-mediated — `analytics` has no `settings` edge), so
	// the Privacy toggle takes effect the moment the new config is persisted.
	setSettingsPublisher((config) => {
		server.publish(
			WS_CHANNELS.settingsChanged,
			JSON.stringify({ channel: WS_CHANNELS.settingsChanged, data: config }),
		);
		setAnalyticsSending(config.analyticsEnabled);
	});

	// Permanent session deletion is shared domain state: every connected client drops the chat and records
	// a tombstone before any older hydration response can land.
	setSessionDeletedPublisher((payload: SessionDeletedPayload) => {
		server.publish(
			WS_CHANNELS.sessionDeleted,
			JSON.stringify({ channel: WS_CHANNELS.sessionDeleted, data: payload }),
		);
	});

	// Stream each in-process AgentSession's events to subscribed clients over the pi.event channel, and
	// tee the best-effort workspace auto-rename off two points, fire-and-forget (`void` — the hooks never
	// reject, and this closure's slot is sync by design): the **first prompt landing** (a user
	// `message_end`, before the model responds) gets an instant non-agentic name, and a **settled turn**
	// (`agent_settled`, after retries/compaction/continuations) refines it with the agentic namer and locks it.
	// The `workspace.updated` push is
	// self-emitted by `renameWorkspace` (via the lifecycle publisher above) — the tee just triggers it.
	setSessionPublisher((payload) => {
		server.publish(
			WS_CHANNELS.piEvent,
			JSON.stringify({ channel: WS_CHANNELS.piEvent, data: payload }),
		);
		if (isPromptCommitted(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId) void maybeNaiveNameWorkspace(payload.sessionId, workspaceId);
		} else if (isSettledTurn(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId) void maybeAutoRenameWorkspace(payload.sessionId, workspaceId);
		}
	});

	// Push extension-UI dialog requests (the in-process `uiContext` bridge) over the pi.extensionUi channel.
	setExtUiPublisher((request) => {
		server.publish(
			WS_CHANNELS.piExtensionUi,
			JSON.stringify({ channel: WS_CHANNELS.piExtensionUi, data: request }),
		);
	});

	// Push in-app login flow frames (the session-less `authStorage.login` bridge) over the provider.login
	// channel. A terminal `success` frame doubles as the `provider_login` analytics moment — the method
	// (`oauth`/`api-key`) comes from `loginAnalytics`'s loginId→method map (recorded by the
	// `provider.loginStart` handler), the provider id is bucketed, so a custom provider name never
	// leaves the process. (jbcentral's `central` method is tracked in its own connect handler.)
	setLoginPublisher((push) => {
		server.publish(
			WS_CHANNELS.providerLogin,
			JSON.stringify({ channel: WS_CHANNELS.providerLogin, data: push }),
		);
		trackLoginOutcome(push);
	});

	// Boot analytics before any trackable action can occur (fire-and-forget by contract — a failure in
	// here can never block or crash the host). The persisted flag gates sending; the analytics module
	// itself mutes CI, `bun test`, and an explicit opt-out (see analytics/mute.ts).
	initializeAnalytics({
		...(appVersion ? { appVersion } : {}),
		...(analytics ?? {}),
		enabled: getConfig().analyticsEnabled,
	});

	// Give back the terminal tabs the last run ended with. The shells themselves are gone — a host restart hangs
	// up every PTY — so each tab gets a fresh one on first attach, showing its predecessor's recorded output.
	reviveTerminalSessions();

	// Open a project on boot if the launcher passed one (e.g. `thinkrail /path/to/repo`). Best-effort:
	// a non-repo / missing dir is a warning, not a boot failure — the UI's Open-Project flow still works.
	if (projectPath) {
		try {
			openProject(projectPath);
		} catch (err) {
			console.warn(
				`Could not open project ${projectPath}: ${err instanceof Error ? err.message : err}`,
			);
		}
	}

	return {
		get port() {
			return server.port ?? port;
		},
		stop() {
			// Symmetric teardown: settle in-flight logins (so no detached `login()` promise leaks), dispose
			// in-process agent sessions + PTYs, then close the socket. Analytics drains first, fire-and-forget
			// (best-effort by contract — stop never waits on the network).
			void shutdownAnalytics();
			cancelAllLogins();
			stopAllWatches();
			disposeAllSessions();
			// Drop the pending abandoned-client reapers before killing the PTYs they would have killed, so no
			// timer outlives the host and keeps the event loop alive after `stop()`. `stopping` stops
			// `server.stop(true)`'s synchronous close handlers from arming replacements.
			stopping = true;
			for (const timer of reapTimers.values()) clearTimeout(timer);
			reapTimers.clear();
			sockets.clear();
			terminalBackpressured.clear();
			requestReplays.clear();
			// Write the tabs and their recorded output down BEFORE killing the shells — this is the only moment
			// the picture still exists, and a restart restores tabs from it (see `persistTerminalSessions`).
			persistTerminalSessions();
			closeAllTerminals();
			server.stop(true);
		},
	};
}

/**
 * Serve a worktree file's raw bytes for `GET /files/<workspaceId>/<relpath>` (e.g. a relative image in
 * the markdown viewer). Path safety is the `fs` module's `resolveWorktreeFile` (refuses escapes); a bad
 * id / escape / missing file is a 404. Bun infers the content-type from the extension.
 */
async function serveWorktreeFile(pathname: string): Promise<Response> {
	const rest = pathname.slice("/files/".length);
	const slash = rest.indexOf("/");
	if (slash <= 0) return new Response("not found", { status: 404 });
	const workspaceId = decodeURIComponent(rest.slice(0, slash));
	const relPath = decodeURIComponent(rest.slice(slash + 1));
	try {
		const file = Bun.file(resolveWorktreeFile(workspaceId, relPath));
		if (!(await file.exists())) return new Response("not found", { status: 404 });
		return new Response(file);
	} catch {
		return new Response("not found", { status: 404 });
	}
}

/** Serve a file from `staticDir`, falling back to index.html (SPA). Paths are contained to the dir. */
async function serveStatic(pathname: string, staticDir: string): Promise<Response> {
	const safe = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
	const requested = safe === "/" || safe === "" ? "index.html" : safe;
	const file = Bun.file(join(staticDir, requested));
	if (await file.exists()) return new Response(file);
	const index = Bun.file(join(staticDir, "index.html"));
	if (await index.exists()) return new Response(index);
	return new Response("not found", { status: 404 });
}
