export const DEFAULT_PORT = 24242;
export const DEFAULT_HOST = "localhost";

export interface CliOptions {
	port: number;
	host: string;
	open: boolean;
	noAnalytics: boolean;
	staticDir: string | undefined;
	projectDir: string | undefined;
	help: boolean;
	version: boolean;
}

export type ParseEnv = Record<string, string | undefined>;

const SUBCOMMANDS = ["update", "uninstall"] as const;

export type Subcommand = (typeof SUBCOMMANDS)[number];

export function parseSubcommand(argv: readonly string[]): Subcommand | undefined {
	return SUBCOMMANDS.find((name) => name === argv[0]);
}

export const USAGE = `Usage: thinkrail [options] [project-dir]
       thinkrail update [--channel stable|nightly] [--version X.Y.Z]
       thinkrail uninstall [--remove-data|--keep-data] [-y]

Boots the ThinkRail engine host in-process and opens the browser to the app.
The \`update\` subcommand re-downloads + installs the latest build for your channel;
\`uninstall\` removes ThinkRail from this machine (your ~/.thinkrail app state is kept
unless you ask for it to go). Both take \`--help\`.

Options:
  --port <n>     Listen port (default ${DEFAULT_PORT}; falls back to a free port if taken).
  --host <h>     Bind host (default ${DEFAULT_HOST}).
  --no-open      Don't open the browser (e.g. headless / remote host).
  --no-analytics Don't send anonymous usage analytics this run (the durable switch
                 lives in the app: Settings → Privacy).
  -v, --version  Print the version and exit.
  -h, --help     Show this help.

Arguments:
  project-dir    A git repo to open as a project on launch (optional).

Env:
  THINKRAIL_PORT / THINKRAIL_HOST   Defaults for --port / --host.
  THINKRAIL_STATIC_DIR                 Override the built web app served by the host.
  THINKRAIL_NO_ANALYTICS               Same as --no-analytics (any non-empty value; read by the host).`;

function readFlagValue(arg: string, next: string | undefined): { value: string; consumed: number } {
	const eq = arg.indexOf("=");
	if (eq !== -1) return { value: arg.slice(eq + 1), consumed: 1 };
	if (next === undefined) throw new Error(`Missing value for ${arg}`);
	return { value: next, consumed: 2 };
}

export function parseArgs(argv: readonly string[], env: ParseEnv = {}): CliOptions {
	let port: number | undefined;
	let host: string | undefined;
	let open = true;
	let noAnalytics = false;
	let help = false;
	let version = false;
	let projectDir: string | undefined;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] as string;
		if (arg === "--no-open") {
			open = false;
		} else if (arg === "--no-analytics") {
			noAnalytics = true;
		} else if (arg === "-h" || arg === "--help") {
			help = true;
		} else if (arg === "-v" || arg === "--version") {
			version = true;
		} else if (arg === "--port" || arg.startsWith("--port=")) {
			const { value, consumed } = readFlagValue(arg, argv[i + 1]);
			const parsed = Number(value);
			if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
				throw new Error(`Invalid --port: ${value}`);
			}
			port = parsed;
			i += consumed - 1;
		} else if (arg === "--host" || arg.startsWith("--host=")) {
			const { value, consumed } = readFlagValue(arg, argv[i + 1]);
			host = value;
			i += consumed - 1;
		} else if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		} else if (projectDir === undefined) {
			projectDir = arg;
		} else {
			throw new Error(`Unexpected argument: ${arg}`);
		}
	}

	const envPort = env.THINKRAIL_PORT !== undefined ? Number(env.THINKRAIL_PORT) : undefined;
	const resolvedPort =
		port ?? (envPort !== undefined && Number.isInteger(envPort) ? envPort : DEFAULT_PORT);

	return {
		port: resolvedPort,
		host: host ?? env.THINKRAIL_HOST ?? DEFAULT_HOST,
		open,
		noAnalytics,
		staticDir: env.THINKRAIL_STATIC_DIR,
		projectDir,
		help,
		version,
	};
}
