import { findFreePort } from "@thinkrail/shared/freePort";
import { resolveShellEnv } from "@thinkrail/shared/shellEnv";
import { settleSessionsForShutdown } from "../agent";
import { shutdownAnalytics } from "../analytics";
import { installCrashLog } from "./crashLog";
import { type CreateServerOptions, createServer, type RunningServer } from "./server";

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
	/** The launcher's baked release version, forwarded onto the `server.welcome` push. */
	appVersion?: string;
	/** Anonymous-analytics wiring (channel + the baked PostHog key + `--no-analytics` mute), forwarded verbatim. */
	analytics?: CreateServerOptions["analytics"];
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
	// First thing: from here on a fatal fault leaves a report behind (in-process pi means any such fault is
	// the whole host's, and this is the only trace it gets).
	installCrashLog(options.appVersion);
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
		...(options.appVersion ? { appVersion: options.appVersion } : {}),
		...(options.analytics ? { analytics: options.analytics } : {}),
	});

	let stopping = false;
	const shutdown = (): void => {
		if (stopping) return;
		stopping = true;
		// Settle before exit: abort streaming sessions and give pi a bounded window to write their
		// "Operation aborted" tool results — an immediate `process.exit` here would strand mid-tool
		// transcripts (an open `ask_user_question` made that deterministic before the ack+terminate
		// redesign) and lean on the restart repair for what a polite shutdown can persist cleanly.
		// Concurrently, drain the analytics queue (bounded, idempotent — `stop()`'s own fire-and-forget
		// call reuses the same drain) so a capture moments before Ctrl-C still lands.
		void (async () => {
			try {
				await Promise.allSettled([settleSessionsForShutdown(), shutdownAnalytics()]);
			} finally {
				server.stop();
				process.exit(0);
			}
		})();
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	return { server, port: server.port, requested };
}
