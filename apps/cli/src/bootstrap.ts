// The `thinkrail` launch sequence, shared by both entries: `index.ts` (run from source) and
// `compiled-entry.ts` (the compiled single-file binary). `build` is how this process was produced — each
// entry names itself, so provenance is a parameter rather than a guess about Bun's internals, and it
// rides analytics as a plain property (see packages/server/src/analytics/SPEC.md).

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type BuildKind, bootHost } from "@thinkrail/server";
import { type CliOptions, parseArgs, parseSubcommand, USAGE } from "./args";
import { runUninstall } from "./uninstall";
import { runUpdate } from "./update";
import { channel, version } from "./version";

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

async function bootstrap(build: BuildKind): Promise<void> {
	const argv = Bun.argv.slice(2);
	// Subcommands, not launch flags: install-management commands that run and exit without a host.
	const subcommand = parseSubcommand(argv);
	if (subcommand) {
		const run = subcommand === "update" ? runUpdate : runUninstall;
		process.exit(await run(argv.slice(1), process.env));
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
		// Anonymous usage analytics: the release channel + this process's provenance + the per-run
		// `--no-analytics` mute. Every channel sends; the durable on/off switch is the app's
		// Settings → Privacy toggle (`AppConfig.analyticsEnabled`), host-side.
		analytics: {
			channel,
			build,
			mute: options.noAnalytics,
		},
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

/** Boot and open, exiting non-zero on failure — the single error path both entries share. */
export async function launch(build: BuildKind): Promise<void> {
	try {
		await bootstrap(build);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
