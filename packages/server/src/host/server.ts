import { join, normalize } from "node:path";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail-pi/contracts";
import { setExtUiPublisher, setSessionPublisher } from "../agent";
import { listProjects } from "../projects";
import { closeAllTerminals, setTerminalPublisher } from "../terminal";
import { handleRequest } from "./handlers";

export interface CreateServerOptions {
	port?: number;
	host?: string;
	/** When set, serve the built web app (SPA) from this directory. */
	staticDir?: string;
}

export interface RunningServer {
	readonly port: number;
	stop: () => void;
}

/** Boot the engine host: Bun.serve HTTP+WS, /health, optional static SPA, and the server.welcome push. */
export function createServer(options: CreateServerOptions = {}): RunningServer {
	const { port = 24242, host = "localhost", staticDir } = options;

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
				ws.send(
					JSON.stringify({
						channel: WS_CHANNELS.serverWelcome,
						data: { protocolVersion: PROTOCOL_VERSION, projects: listProjects() },
					}),
				);
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

	// Stream each in-process AgentSession's events to subscribed clients over the pi.event channel.
	setSessionPublisher((payload) => {
		server.publish(
			WS_CHANNELS.piEvent,
			JSON.stringify({ channel: WS_CHANNELS.piEvent, data: payload }),
		);
	});

	// Push extension-UI dialog requests (the in-process `uiContext` bridge) over the pi.extensionUi channel.
	setExtUiPublisher((request) => {
		server.publish(
			WS_CHANNELS.piExtensionUi,
			JSON.stringify({ channel: WS_CHANNELS.piExtensionUi, data: request }),
		);
	});

	return {
		get port() {
			return server.port ?? port;
		},
		stop() {
			closeAllTerminals();
			server.stop(true);
		},
	};
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
