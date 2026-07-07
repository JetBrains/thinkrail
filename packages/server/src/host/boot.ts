import { findFreePort } from "@thinkrail/shared/freePort";
import { resolveShellEnv } from "@thinkrail/shared/shellEnv";
import { createServer, type RunningServer } from "./server";

export interface BootHostOptions {
	/** Requested listen port. */
	port: number;
	/** Bind host (e.g. `localhost`, or `0.0.0.0` for the Tailscale seam). */
	host: string;
	/**
	 * How the requested port is treated. `"exact"` binds it as-is — for a host whose port a coordinator
	 * pinned and matches elsewhere (vite's `/ws` proxy, Playwright's `baseURL`). `"free"` scans upward for
	 * the first open port — for a standalone launcher that must not collide with another running instance.
	 */
	portMode: "exact" | "free";
	/** When set, serve the built web app (SPA) from this directory. */
	staticDir?: string;
	/** When set, open this git repo as a project on boot (best-effort — a launcher convenience). */
	projectPath?: string;
}

export interface BootedHost {
	readonly server: RunningServer;
	/** The port actually bound — may exceed `requested` under `portMode: "free"`. */
	readonly port: number;
	/** The port that was requested, for the caller to compare against `port` (e.g. to warn on a bump). */
	readonly requested: number;
}

/**
 * Boot the engine host as a process: resolve the login-shell PATH (so the in-process agent's tools —
 * git/node/… — resolve even under the minimal env of a GUI/npx launch), pick the port per `portMode`,
 * start the server, and install SIGINT/SIGTERM handlers that dispose sessions + PTYs and close the socket
 * before exiting.
 */
export async function bootHost(options: BootHostOptions): Promise<BootedHost> {
	// Must precede any AgentSession creation; createServer makes sessions lazily, so here is early enough.
	resolveShellEnv();

	const requested = options.port;
	const port =
		options.portMode === "free" ? await findFreePort(requested, options.host) : requested;

	const server = createServer({
		port,
		host: options.host,
		...(options.staticDir ? { staticDir: options.staticDir } : {}),
		...(options.projectPath ? { projectPath: options.projectPath } : {}),
	});

	let stopping = false;
	const shutdown = (): void => {
		if (stopping) return;
		stopping = true;
		server.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	return { server, port: server.port, requested };
}
