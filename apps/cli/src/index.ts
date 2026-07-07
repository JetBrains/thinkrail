#!/usr/bin/env bun
// The `thinkrail` bin: boots the engine host in-process (same Bun loop) and opens the browser to the
// app. A thin launcher — all engine logic lives in `@thinkrail/server`.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { bootHost } from "@thinkrail/server";
import { type CliOptions, parseArgs, USAGE } from "./args";
import { runUpdate } from "./update";
import { version } from "./version";

/** The built web app shipped with the bin, relative to this file (src in dev, dist when bundled). */
const DEFAULT_STATIC_DIR = resolve(import.meta.dir, "../../web/dist");

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
	const argv = Bun.argv.slice(2);
	// `update` is a subcommand, not a launch flag: re-install the latest build, then exit.
	if (argv[0] === "update") {
		process.exit(await runUpdate(argv.slice(1), process.env));
	}

	let options: CliOptions;
	try {
		options = parseArgs(argv, process.env);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${USAGE}`);
		process.exit(1);
	}

	if (options.help) {
		console.log(USAGE);
		return;
	}

	if (options.version) {
		console.log(version);
		return;
	}

	const staticDir = options.staticDir ?? DEFAULT_STATIC_DIR;
	if (!existsSync(staticDir)) {
		console.warn(`Web app not found at ${staticDir} — run \`bun run build:web\` to build the UI.`);
	}

	// Standalone launcher: free-pick the port so a second instance never collides, serve the bundled SPA,
	// and (via bootHost) resolve the shell PATH + install graceful-shutdown handlers.
	const { port, requested } = await bootHost({
		port: options.port,
		host: options.host,
		portMode: "free",
		staticDir,
		appVersion: version,
		...(options.projectDir ? { projectPath: resolve(process.cwd(), options.projectDir) } : {}),
	});
	if (port !== requested) {
		console.warn(`Port ${requested} is in use; using free port ${port}.`);
	}

	// `localhost`/`0.0.0.0`/`::` are bind hosts, not addresses to open — point the browser at localhost.
	const openHost = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
	const url = `http://${openHost}:${port}`;
	console.log(`thinkrail → ${url}`);
	if (options.open) openBrowser(url);
}

bootstrap().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exit(1);
});
