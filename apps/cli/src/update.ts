// `thinkrail update` — self-update by re-running the published install.sh for the binary's channel
// (the Bun-native port of the old repo's `thinkrail upgrade`, renamed). The installer owns the
// download → checksum → replace → PATH logic; update just fetches it and feeds it the resolved
// channel/prefix (from `~/.config/thinkrail/install.json`, else the baked channel + `~/.local`). Unix
// only — in-place self-replace on Windows is deferred, so we point there at the install.ps1 command
// (which handles a locked running exe), spelled out per shell, with the releases page as the fallback.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { channel as bakedChannel, version } from "./version";

const DEFAULT_INSTALL_SCRIPT_URL =
	"https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh";
/** X.Y.Z, X.Y.Z-nightly.N, or the literal `latest`. */
const VERSION_RE = /^(?:latest|\d+\.\d+\.\d+(?:-nightly\.\d+)?)$/;
/** Prefix is spliced into `bash` args + written into shell rc files by install.sh — reject shell metachars. */
const PREFIX_FORBIDDEN_RE = /[;|&`$<>\n\r"'\\]/;

export const UPDATE_USAGE = `Usage: thinkrail update [options]

Re-download and install the latest ThinkRail for the current channel.

Options:
  --channel stable|nightly   Override the channel (default: the installed channel).
  --version X.Y.Z|latest     Install a specific version (default: latest).
  -h, --help                 Show this help.`;

export interface UpdateArgs {
	channel?: "stable" | "nightly";
	version: string;
}

/** Parse `update`'s argv (the slice after `update`). Throws on an unknown flag or a bad channel/version. */
export function parseUpdateArgs(argv: readonly string[]): UpdateArgs {
	let channel: "stable" | "nightly" | undefined;
	let version = "latest";
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] as string;
		const eq = arg.indexOf("=");
		const inlineValue = eq !== -1 ? arg.slice(eq + 1) : undefined;
		const readValue = (): string => {
			if (inlineValue !== undefined) return inlineValue;
			const next = argv[i + 1];
			if (next === undefined) throw new Error(`Missing value for ${arg}`);
			i += 1;
			return next;
		};
		if (arg === "--channel" || arg.startsWith("--channel=")) {
			const value = readValue();
			if (value !== "stable" && value !== "nightly") {
				throw new Error(`Invalid --channel: ${value} (expected stable or nightly)`);
			}
			channel = value;
		} else if (arg === "--version" || arg.startsWith("--version=")) {
			version = readValue();
		} else {
			throw new Error(`Unknown option: ${arg}`);
		}
	}
	if (!VERSION_RE.test(version)) throw new Error(`Invalid --version: ${version}`);
	return channel ? { channel, version } : { version };
}

export interface ResolveUpdateInput {
	args: UpdateArgs;
	/** Parsed `~/.config/thinkrail/install.json` (or `{}` when absent/unreadable). */
	installMeta: { channel?: unknown; prefix?: unknown };
	/** The version module's baked channel (`stable` / `nightly` / `dev`). */
	baked: string;
	home: string;
}

export interface UpdatePlan {
	channel: "stable" | "nightly";
	prefix: string;
	/** Args for `bash -s` (stdin = the fetched install.sh). */
	bashArgs: string[];
}

/**
 * Which channel a re-install targets: an explicit flag wins, else the install metadata, else the baked
 * channel (falling back to `stable` for a from-source `dev` build). Shared by the Unix plan and the
 * Windows advice, so both name the same channel.
 */
export function resolveUpdateChannel(
	args: UpdateArgs,
	metaChannel: unknown,
	baked: string,
): "stable" | "nightly" {
	return (
		args.channel ??
		(metaChannel === "stable" || metaChannel === "nightly" ? metaChannel : undefined) ??
		(baked === "stable" || baked === "nightly" ? baked : "stable")
	);
}

/**
 * Resolve which channel + prefix the re-install should target: channel per `resolveUpdateChannel`; the
 * prefix comes from the metadata, else `~/.local`. Throws on an unsafe prefix.
 */
export function resolveUpdatePlan(input: ResolveUpdateInput): UpdatePlan {
	const channel = resolveUpdateChannel(input.args, input.installMeta.channel, input.baked);

	const metaPrefix = input.installMeta.prefix;
	const prefix =
		typeof metaPrefix === "string" && metaPrefix ? metaPrefix : join(input.home, ".local");
	if (PREFIX_FORBIDDEN_RE.test(prefix) || !isAbsolute(prefix)) {
		throw new Error(`Refusing suspicious install prefix from metadata: ${prefix}`);
	}

	const bashArgs = ["-s", "--", "--channel", channel, "--prefix", prefix];
	if (input.args.version !== "latest") bashArgs.push("--version", input.args.version);
	return { channel, prefix, bashArgs };
}

const INSTALL_PS1_URL = "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1";
/** Rooted Windows path — `X:\…` or a UNC `\\server\share\…`; mirrors install.ps1's `IsPathRooted` gate. */
const WINDOWS_ROOTED_RE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/;
/**
 * Chars that make a prefix unsafe to print inside cmd's `set "X=…"` or PowerShell's `'…'`: a double
 * quote closes cmd's quoting, `%` is expanded by cmd before the installer ever sees it, and `;`/newlines
 * would break the `;`-delimited PATH value install.ps1 writes (it rejects those too). `&`/`|`/`<`/`>`/`^`
 * are literal inside both quotings, so a legitimate `C:\R&D\tools` still works. Windows needs its own
 * list: `PREFIX_FORBIDDEN_RE` rejects the backslash every Windows path is made of.
 */
const WINDOWS_PREFIX_FORBIDDEN_RE = /["%;\n\r]/;

/**
 * The `THINKRAIL_PREFIX` the printed command needs, or `undefined` when the recorded prefix is already
 * the installer's own default (`<home>\.local`) and the var would be noise. Without this, a user who
 * installed under `D:\tools` would follow the command and get a *second* copy under `.local` while the
 * `thinkrail.exe` their PATH resolves stays on the old build. Throws on a prefix that isn't a rooted
 * Windows path or can't be safely quoted — a tampered `install.json` must not shape a command we hand
 * the user to paste (the Unix path refuses the same way).
 */
export function resolveWindowsPrefix(metaPrefix: unknown, home: string): string | undefined {
	if (typeof metaPrefix !== "string" || !metaPrefix) return undefined;
	if (!WINDOWS_ROOTED_RE.test(metaPrefix) || WINDOWS_PREFIX_FORBIDDEN_RE.test(metaPrefix)) {
		throw new Error(`Refusing suspicious install prefix from metadata: ${metaPrefix}`);
	}
	const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
	return norm(metaPrefix) === norm(`${home}\\.local`) ? undefined : metaPrefix;
}

/**
 * What to print instead of self-updating on Windows: the `install.ps1` one-liner, spelled out **per
 * shell** — cmd's `set "X=v" &&` and PowerShell's `$env:X='v';` are not interchangeable, and a
 * PowerShell user pasting the cmd form would silently re-install the wrong channel/version (`set` there
 * is `Set-Variable`, which never reaches the child process). Carries every option that would otherwise
 * be lost, so re-running the installer reproduces *this* install rather than a default one. Env vars
 * appear only when they'd change the outcome, so the common case stays a single copyable command.
 */
export function windowsUpdateMessage(
	channel: "stable" | "nightly",
	version: string,
	prefix?: string,
): string {
	const vars: Array<[string, string]> = [];
	if (channel !== "stable") vars.push(["THINKRAIL_CHANNEL", channel]);
	if (version !== "latest") vars.push(["THINKRAIL_VERSION", version]);
	if (prefix) vars.push(["THINKRAIL_PREFIX", prefix]);
	// PowerShell's single quotes are literal except for `'` itself, which doubles to escape.
	const psPrefix = vars.map(([k, v]) => `$env:${k}='${v.replace(/'/g, "''")}'; `).join("");
	const cmdPrefix = vars.map(([k, v]) => `set "${k}=${v}" && `).join("");
	const what =
		version === "latest" ? `the latest ${channel} build` : `ThinkRail ${version} (${channel})`;
	// ASCII only: a legacy conhost code page would garble a dash/ellipsis in the copyable block.
	return [
		"Automatic in-place update isn't supported on Windows yet.",
		`Re-run the installer to get ${what}. Pick the line for your shell:`,
		`  PowerShell:  ${psPrefix}irm ${INSTALL_PS1_URL} | iex`,
		`  cmd:         ${cmdPrefix}powershell -c "irm ${INSTALL_PS1_URL} | iex"`,
		"Or download manually: https://github.com/JetBrains/thinkrail/releases",
	].join("\n");
}

function readInstallMeta(home: string): { channel?: unknown; prefix?: unknown } {
	try {
		return JSON.parse(readFileSync(join(home, ".config", "thinkrail", "install.json"), "utf8"));
	} catch {
		return {};
	}
}

/** Run the `update` subcommand. Returns a process exit code. */
export async function runUpdate(
	argv: readonly string[],
	env: Record<string, string | undefined>,
): Promise<number> {
	if (argv.includes("-h") || argv.includes("--help")) {
		console.log(UPDATE_USAGE);
		return 0;
	}
	let plan: UpdatePlan;
	try {
		const args = parseUpdateArgs(argv);
		const home = homedir();
		const installMeta = readInstallMeta(home);
		if (process.platform === "win32") {
			// Resolve channel + prefix the same way the Unix plan does, so the printed command re-installs
			// *this* install instead of silently dropping the user onto stable under the default prefix.
			const channel = resolveUpdateChannel(args, installMeta.channel, bakedChannel);
			const prefix = resolveWindowsPrefix(installMeta.prefix, home);
			console.error(windowsUpdateMessage(channel, args.version, prefix));
			return 1;
		}
		plan = resolveUpdatePlan({ args, installMeta, baked: bakedChannel, home });
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${UPDATE_USAGE}`);
		return 1;
	}

	console.log(`Updating ThinkRail (current: ${version}, channel: ${plan.channel}) …`);

	const url = env.THINKRAIL_INSTALL_SCRIPT_URL ?? DEFAULT_INSTALL_SCRIPT_URL;
	const fetched = Bun.spawnSync(["curl", "-fsSL", url], { stdout: "pipe", stderr: "inherit" });
	if (!fetched.success || fetched.stdout.length === 0) {
		console.error("error: failed to fetch the installer");
		return 1;
	}

	// Feed the fetched script to `bash -s` (inherits env for PATH, etc.).
	const run = Bun.spawnSync(["bash", ...plan.bashArgs], {
		stdin: fetched.stdout,
		stdout: "inherit",
		stderr: "inherit",
		env,
	});
	return run.exitCode ?? 1;
}
