// Pure CLI argument + env parsing for the `thinkrail` bin. Kept free of any `@thinkrail/server`
// import so it stays cheaply unit-testable (no `pi` runtime pulled in).

export const DEFAULT_PORT = 24242;
export const DEFAULT_HOST = "localhost";

export interface CliOptions {
	/** Requested listen port (flag > env > default). The actual port may differ after a collision fallback. */
	port: number;
	host: string;
	/** Open the browser at the resolved URL on boot. */
	open: boolean;
	/**
	 * `--no-analytics`: mute anonymous usage analytics for this run. The `THINKRAIL_NO_ANALYTICS` env
	 * spelling is honored by the host itself (`packages/server/src/analytics/mute.ts`, its single reader),
	 * so it is deliberately not folded in here.
	 */
	noAnalytics: boolean;
	/** Static SPA dir override (`THINKRAIL_STATIC_DIR`); when unset the bin derives a default. */
	staticDir: string | undefined;
	/** A git repo to open as a project on boot (the positional arg), or undefined. */
	projectDir: string | undefined;
	/** `--help`/`-h` was requested — the bin prints usage and exits. */
	help: boolean;
	/** `--version`/`-v` was requested — the bin prints the baked version and exits. */
	version: boolean;
}

export type ParseEnv = Record<string, string | undefined>;

/**
 * Positionals intercepted *before* the launch flags: each is its own command with its own arg parser, and
 * none of them boots the host. Named here because the compiled entry needs the set too — a subcommand
 * must not pay for staging the embedded assets (and `uninstall` would be re-creating the cache it deletes).
 */
const SUBCOMMANDS = ["update", "uninstall"] as const;

export type Subcommand = (typeof SUBCOMMANDS)[number];

/** The leading subcommand of `argv` (the slice after the runtime + script), or `undefined` for a launch. */
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

/** Read a flag's value from either `--flag value` or `--flag=value`; returns the value + how many argv slots it consumed. */
function readFlagValue(arg: string, next: string | undefined): { value: string; consumed: number } {
	const eq = arg.indexOf("=");
	if (eq !== -1) return { value: arg.slice(eq + 1), consumed: 1 };
	if (next === undefined) throw new Error(`Missing value for ${arg}`);
	return { value: next, consumed: 2 };
}

/**
 * Parse the bin's argv (the slice *after* the runtime + script) + the process env into resolved options.
 * Precedence is flag > env > built-in default. Throws on an unknown flag, a missing flag value, an
 * unparseable `--port`, or more than one positional dir.
 */
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
