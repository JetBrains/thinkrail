#!/usr/bin/env bun
// The `thinkrail-pi` bin: boots the engine host in-process (same Bun loop) and opens the browser to the
// app. A thin launcher — all engine logic lives in `@thinkrail-pi/server`.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type CreateServerOptions, createServer, type RunningServer } from "@thinkrail-pi/server";
import { findFreePort } from "@thinkrail-pi/shared/freePort";
import { resolveShellEnv } from "@thinkrail-pi/shared/shellEnv";
import { type CliOptions, DEFAULT_HOST, DEFAULT_PORT, parseArgs, USAGE } from "./args";

/** The built web app shipped with the bin, relative to this file (src in dev, dist when bundled). */
const DEFAULT_STATIC_DIR = resolve(import.meta.dir, "../../web/dist");

/**
 * Start the host on a free port at or above the requested one. `Bun.serve` does not report a busy
 * `localhost` port (it can share it via `SO_REUSEPORT`), so `findFreePort` probes for an open one rather
 * than relying on a bind error.
 */
async function startServer(options: CreateServerOptions): Promise<RunningServer> {
	const requested = options.port ?? DEFAULT_PORT;
	const port = await findFreePort(requested, options.host ?? DEFAULT_HOST);
	if (port !== requested) {
		console.warn(`Port ${requested} is in use; using free port ${port}.`);
	}
	return createServer({ ...options, port });
}

/** Open the user's default browser at `url` (cross-platform), best-effort — never blocks/keeps us alive. */
function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).unref();
	} catch {
		// Headless / no browser available — the URL is logged, so this is non-fatal.
	}
}

async function bootstrap(): Promise<void> {
	let options: CliOptions;
	try {
		options = parseArgs(Bun.argv.slice(2), process.env);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${USAGE}`);
		process.exit(1);
	}

	if (options.help) {
		console.log(USAGE);
		return;
	}

	// PATH first: a GUI-/npx-launched process inherits a minimal PATH, so the in-process agent's tools
	// (git/node/…) wouldn't resolve. Must run before any AgentSession is created (sessions are lazy here).
	resolveShellEnv();

	const staticDir = options.staticDir ?? DEFAULT_STATIC_DIR;
	if (!existsSync(staticDir)) {
		console.warn(`Web app not found at ${staticDir} — run \`bun run build:web\` to build the UI.`);
	}

	const server = await startServer({
		port: options.port,
		host: options.host,
		staticDir,
		...(options.projectDir ? { projectPath: resolve(process.cwd(), options.projectDir) } : {}),
	});

	// `localhost`/`0.0.0.0`/`::` are bind hosts, not addresses to open — point the browser at localhost.
	const openHost = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
	const url = `http://${openHost}:${server.port}`;
	console.log(`thinkrail-pi → ${url}`);
	if (options.open) openBrowser(url);

	// Graceful shutdown: dispose agent sessions + PTYs and close the socket (server.stop), then exit.
	let stopping = false;
	const shutdown = (): void => {
		if (stopping) return;
		stopping = true;
		server.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

bootstrap().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
