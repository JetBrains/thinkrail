import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type BuildKind, bootHost } from "@thinkrail/server";
import { printStartupMark } from "@thinkrail/shared/startupMark";
import { type CliOptions, parseArgs, parseSubcommand, USAGE } from "./args";
import { runUninstall } from "./uninstall";
import { runUpdate } from "./update";
import { channel, version } from "./version";

const DEFAULT_STATIC_DIR = resolve(import.meta.dir, "../../web/dist");

function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).unref();
	} catch {}
}

async function bootstrap(build: BuildKind): Promise<void> {
	const argv = Bun.argv.slice(2);
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

	const { port, requested } = await bootHost({
		port: options.port,
		host: options.host,
		portMode: "free",
		staticDir,
		appVersion: version,
		...(options.verbose ? { verbose: true } : {}),
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

	const openHost = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
	const url = `http://${openHost}:${port}`;
	printStartupMark({ status: "host ready", endpoint: url });
	console.log(`thinkrail → ${url}`);
	if (options.open) openBrowser(url);
}

export async function launch(build: BuildKind): Promise<void> {
	try {
		await bootstrap(build);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
