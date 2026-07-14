import { join, normalize } from "node:path";
import type { ServerWelcome, Workspace } from "@thinkrail/contracts";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import {
	disposeAllSessions,
	getSessionWorkspaceId,
	setExtUiPublisher,
	setSessionPublisher,
} from "../agent";
import { cancelAllLogins, setLoginPublisher } from "../auth";
import { resolveWorktreeFile } from "../fs";
import { listProjects, openProject } from "../projects";
import { closeAllTerminals, setTerminalPublisher } from "../terminal";
import {
	isPromptCommitted,
	isSettledTurn,
	maybeAutoRenameWorkspace,
	maybeNaiveNameWorkspace,
} from "./autoRename";
import { handleRequest } from "./handlers";

export interface CreateServerOptions {
	port?: number;
	host?: string;
	/** When set, serve the built web app (SPA) from this directory. */
	staticDir?: string;
	/** When set, open this git repo as a project on boot (best-effort — a launcher convenience). */
	projectPath?: string;
	/** The launcher's baked release version, echoed in the `server.welcome` push (undefined from source). */
	appVersion?: string;
}

export interface RunningServer {
	readonly port: number;
	stop: () => void;
}

/** Boot the engine host: Bun.serve HTTP+WS, /health, optional static SPA, and the server.welcome push. */
export function createServer(options: CreateServerOptions = {}): RunningServer {
	const { port = 24242, host = "localhost", staticDir, projectPath, appVersion } = options;

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
				ws.subscribe(WS_CHANNELS.workspaceUpdated);
				const welcome: ServerWelcome = {
					protocolVersion: PROTOCOL_VERSION,
					projects: listProjects(),
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
					ws.send(JSON.stringify({ id: req.id, ok: false, error }));
				}
			},
		},
	});

	// Stream PTY output to every subscribed client over the terminal.data channel.
	setTerminalPublisher((channel, data) => {
		server.publish(channel, JSON.stringify({ channel, data }));
	});

	// Push a host-initiated workspace mutation (an auto-rename) to every subscribed client. The web store
	// folds `workspace.updated` by id, so a naive-then-agentic pair is two idempotent updates (last wins).
	const pushWorkspaceUpdated = (ws: Workspace | null): void => {
		if (!ws) return;
		server.publish(
			WS_CHANNELS.workspaceUpdated,
			JSON.stringify({ channel: WS_CHANNELS.workspaceUpdated, data: ws }),
		);
	};

	// Stream each in-process AgentSession's events to subscribed clients over the pi.event channel, and
	// tee the best-effort workspace auto-rename off two points, fire-and-forget (`void` — the hooks never
	// reject, and this closure's slot is sync by design): the **first prompt landing** (a user
	// `message_end`, before the model responds) gets an instant non-agentic name, and a **settled turn**
	// (agent_end, no retry) refines it with the agentic namer and locks it. Both push `workspace.updated`.
	setSessionPublisher((payload) => {
		server.publish(
			WS_CHANNELS.piEvent,
			JSON.stringify({ channel: WS_CHANNELS.piEvent, data: payload }),
		);
		if (isPromptCommitted(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId) {
				void maybeNaiveNameWorkspace(payload.sessionId, workspaceId).then(pushWorkspaceUpdated);
			}
		} else if (isSettledTurn(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId) {
				void maybeAutoRenameWorkspace(payload.sessionId, workspaceId).then(pushWorkspaceUpdated);
			}
		}
	});

	// Push extension-UI dialog requests (the in-process `uiContext` bridge) over the pi.extensionUi channel.
	setExtUiPublisher((request) => {
		server.publish(
			WS_CHANNELS.piExtensionUi,
			JSON.stringify({ channel: WS_CHANNELS.piExtensionUi, data: request }),
		);
	});

	// Push in-app login flow frames (the session-less `authStorage.login` bridge) over the provider.login channel.
	setLoginPublisher((push) => {
		server.publish(
			WS_CHANNELS.providerLogin,
			JSON.stringify({ channel: WS_CHANNELS.providerLogin, data: push }),
		);
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
			// in-process agent sessions + PTYs, then close the socket.
			cancelAllLogins();
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
