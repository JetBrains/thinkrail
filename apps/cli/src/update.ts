// `thinkrail update` — self-update by re-running the published install.sh for the binary's channel
// (the Bun-native port of the old repo's `thinkrail upgrade`, renamed). The installer owns the
// download → checksum → replace → PATH logic; update just fetches it and feeds it the resolved
// channel/prefix (from `~/.config/thinkrail/install.json`, else the baked channel + `~/.local`). Unix
// only — replacing a running .exe in place isn't possible on Windows, so we point there to the releases.

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
 * Resolve which channel + prefix the re-install should target: an explicit flag wins, else the install
 * metadata, else the baked channel (falling back to `stable` for a from-source `dev` build); the prefix
 * comes from the metadata, else `~/.local`. Throws on an unsafe prefix.
 */
export function resolveUpdatePlan(input: ResolveUpdateInput): UpdatePlan {
	const metaChannel = input.installMeta.channel;
	const channel: "stable" | "nightly" =
		input.args.channel ??
		(metaChannel === "stable" || metaChannel === "nightly" ? metaChannel : undefined) ??
		(input.baked === "stable" || input.baked === "nightly" ? input.baked : "stable");

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
	if (process.platform === "win32") {
		console.error(
			"Automatic update on Windows is not yet supported.\nDownload the latest binary from:\nhttps://github.com/JetBrains/thinkrail/releases",
		);
		return 1;
	}

	let plan: UpdatePlan;
	try {
		const args = parseUpdateArgs(argv);
		const home = homedir();
		plan = resolveUpdatePlan({
			args,
			installMeta: readInstallMeta(home),
			baked: bakedChannel,
			home,
		});
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
