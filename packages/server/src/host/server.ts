import { join, normalize } from "node:path";
import type { ServerWelcome, WorkspaceFsChangedPayload } from "@thinkrail/contracts";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { errorCodeOf } from "@thinkrail/shared/codedError";
import {
	disposeAllSessions,
	getSessionWorkspaceId,
	setExtUiPublisher,
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
import { getConfig, setSettingsPublisher } from "../settings";
import { closeAllTerminals, setTerminalPublisher } from "../terminal";
import { setRepoMetaPublisher, setWatchPublisher, stopAllWatches } from "../watch";
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

	const server = Bun.serve({
		port,
		hostname: host,
		async fetch(req, srv) {
			const url = new URL(req.url);
			if (url.pathname === "/ws") {
				return srv.upgrade(req) ? undefined : new Response("ws upgrade failed", { status: 400 });
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
				ws.subscribe(WS_CHANNELS.terminalData);
				ws.subscribe(WS_CHANNELS.piEvent);
				ws.subscribe(WS_CHANNELS.piExtensionUi);
				ws.subscribe(WS_CHANNELS.providerLogin);
				ws.subscribe(WS_CHANNELS.projectUpdated);
				ws.subscribe(WS_CHANNELS.workspaceCreated);
				ws.subscribe(WS_CHANNELS.workspaceUpdated);
				ws.subscribe(WS_CHANNELS.workspaceRemoved);
				ws.subscribe(WS_CHANNELS.workspaceFsChanged);
				ws.subscribe(WS_CHANNELS.settingsChanged);
				const welcome: ServerWelcome = {
					protocolVersion: PROTOCOL_VERSION,
					projects: listProjects(),
					recentProjects: listRecentProjects(),
					config: getConfig(),
					...(appVersion ? { appVersion } : {}),
				};
				ws.send(JSON.stringify({ channel: WS_CHANNELS.serverWelcome, data: welcome }));
			},
			async message(ws, message) {
				const raw = typeof message === "string" ? message : message.toString();
				let req: { id?: string; method?: string; params?: unknown };
				try {
					req = JSON.parse(raw);
				} catch {
					return;
				}
				if (!req.id || !req.method) return;
				try {
					const result = await handleRequest(req.method, req.params);
					ws.send(JSON.stringify({ id: req.id, ok: true, result }));
				} catch (err) {
					const error = err instanceof Error ? err.message : String(err);
					// A failure the host can *name* travels as a code too (`CodedError`), so a client can react to
					// this error specifically instead of pattern-matching a message.
					const code = errorCodeOf(err);
					ws.send(
						JSON.stringify({ id: req.id, ok: false, error, ...(code ? { errorCode: code } : {}) }),
					);
				}
			},
		},
	});

	// Stream PTY output to every subscribed client over the terminal.data channel.
	setTerminalPublisher((channel, data) => {
		server.publish(channel, JSON.stringify({ channel, data }));
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
	const publishFsChanged = (payload: WorkspaceFsChangedPayload) => {
		server.publish(
			WS_CHANNELS.workspaceFsChanged,
			JSON.stringify({ channel: WS_CHANNELS.workspaceFsChanged, data: payload }),
		);
	};
	setWatchPublisher(publishFsChanged);
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
		publishFsChanged({ workspaceId, paths: [], truncated: false });
	});

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

	// Stream each in-process AgentSession's events to subscribed clients over the pi.event channel, and
	// tee the best-effort workspace auto-rename off two points, fire-and-forget (`void` — the hooks never
	// reject, and this closure's slot is sync by design): the **first prompt landing** (a user
	// `message_end`, before the model responds) gets an instant non-agentic name, and a **settled turn**
	// (agent_end, no retry) refines it with the agentic namer and locks it. The `workspace.updated` push is
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
