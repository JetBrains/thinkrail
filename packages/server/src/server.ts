import { join, normalize } from "node:path";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail-pi/contracts";

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
				ws.send(
					JSON.stringify({
						channel: WS_CHANNELS.serverWelcome,
						data: { protocolVersion: PROTOCOL_VERSION, projects: [] },
					}),
				);
			},
			message() {
				// Dispatch registry is empty until M4 (project/workspace/fs/git/terminal handlers).
			},
		},
	});

	return {
		get port() {
			return server.port ?? port;
		},
		stop() {
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
