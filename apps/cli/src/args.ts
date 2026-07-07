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
	/** Static SPA dir override (`THINKRAIL_STATIC_DIR`); when unset the bin derives a default. */
	staticDir: string | undefined;
	/** A git repo to open as a project on boot (the positional arg), or undefined. */
	projectDir: string | undefined;
	/** `--help`/`-h` was requested — the bin prints usage and exits. */
	help: boolean;
}

export type ParseEnv = Record<string, string | undefined>;

export const USAGE = `Usage: thinkrail [options] [project-dir]

Boots the ThinkRail engine host in-process and opens the browser to the app.

Options:
  --port <n>     Listen port (default ${DEFAULT_PORT}; falls back to a free port if taken).
  --host <h>     Bind host (default ${DEFAULT_HOST}).
  --no-open      Don't open the browser (e.g. headless / remote host).
  -h, --help     Show this help.

Arguments:
  project-dir    A git repo to open as a project on launch (optional).

Env:
  THINKRAIL_PORT / THINKRAIL_HOST   Defaults for --port / --host.
  THINKRAIL_STATIC_DIR                 Override the built web app served by the host.`;

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
	let help = false;
	let projectDir: string | undefined;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] as string;
		if (arg === "--no-open") {
			open = false;
		} else if (arg === "-h" || arg === "--help") {
			help = true;
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
		staticDir: env.THINKRAIL_STATIC_DIR,
		projectDir,
		help,
	};
}
