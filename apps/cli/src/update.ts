import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { channel as bakedChannel, version } from "@thinkrail/shared/version";
import { type InstallMeta, readInstallMeta } from "./paths";
import { psQuote, runPowerShellScript } from "./powershell";

const DEFAULT_INSTALL_SCRIPT_URL =
	"https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh";
const VERSION_RE = /^(?:latest|\d+\.\d+\.\d+(?:-nightly\.\d+)?)$/;
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
	installMeta: InstallMeta;
	baked: string;
	home: string;
}

export interface UpdatePlan {
	channel: "stable" | "nightly";
	prefix: string;
	bashArgs: string[];
}

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

const DEFAULT_INSTALL_PS1_URL =
	"https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1";
const WINDOWS_ROOTED_RE = /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/;
const WINDOWS_PREFIX_FORBIDDEN_RE = /["%;\n\r]/;

function sameWindowsPath(a: string, b: string): boolean {
	const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
	return norm(a) === norm(b);
}

export function resolveWindowsInstallPrefix(metaPrefix: unknown, home: string): string {
	const prefix = typeof metaPrefix === "string" && metaPrefix ? metaPrefix : `${home}\\.local`;
	if (!WINDOWS_ROOTED_RE.test(prefix) || WINDOWS_PREFIX_FORBIDDEN_RE.test(prefix)) {
		throw new Error(`Refusing suspicious install prefix from metadata: ${prefix}`);
	}
	return prefix;
}

export function resolveWindowsPrefix(metaPrefix: unknown, home: string): string | undefined {
	const prefix = resolveWindowsInstallPrefix(metaPrefix, home);
	return sameWindowsPath(prefix, `${home}\\.local`) ? undefined : prefix;
}

export interface WindowsUpdatePlan {
	channel: "stable" | "nightly";
	version: string;
	prefix: string;
	psArgs: string[];
	manualPrefix: string | undefined;
}

export function resolveWindowsUpdatePlan(input: ResolveUpdateInput): WindowsUpdatePlan {
	const channel = resolveUpdateChannel(input.args, input.installMeta.channel, input.baked);
	const prefix = resolveWindowsInstallPrefix(input.installMeta.prefix, input.home);
	const version = input.args.version;
	return {
		channel,
		version,
		prefix,
		psArgs: ["-Channel", channel, "-Version", version, "-Prefix", prefix],
		manualPrefix: resolveWindowsPrefix(input.installMeta.prefix, input.home),
	};
}

export function windowsManualUpdateMessage(
	channel: "stable" | "nightly",
	version: string,
	prefix?: string,
): string {
	const vars: Array<[string, string]> = [];
	if (channel !== "stable") vars.push(["THINKRAIL_CHANNEL", channel]);
	if (version !== "latest") vars.push(["THINKRAIL_VERSION", version]);
	if (prefix) vars.push(["THINKRAIL_PREFIX", prefix]);
	const psPrefix = vars.map(([k, v]) => `$env:${k}=${psQuote(v)}; `).join("");
	const cmdPrefix = vars.map(([k, v]) => `set "${k}=${v}" && `).join("");
	const what =
		version === "latest" ? `the latest ${channel} build` : `ThinkRail ${version} (${channel})`;
	return [
		`Re-run the installer by hand to get ${what}. Pick the line for your shell:`,
		`  PowerShell:  ${psPrefix}irm ${DEFAULT_INSTALL_PS1_URL} | iex`,
		`  cmd:         ${cmdPrefix}powershell -c "irm ${DEFAULT_INSTALL_PS1_URL} | iex"`,
		"Or download manually: https://github.com/JetBrains/thinkrail/releases",
	].join("\n");
}

async function fetchInstaller(url: string): Promise<string | undefined> {
	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const script = await response.text();
		if (!script.trim()) throw new Error("empty response");
		return script;
	} catch (err) {
		console.error(
			`error: failed to fetch the installer (${err instanceof Error ? err.message : String(err)})`,
		);
		return undefined;
	}
}

async function runWindowsUpdate(
	plan: WindowsUpdatePlan,
	env: Record<string, string | undefined>,
): Promise<number> {
	const manual = () => {
		console.error(`\n${windowsManualUpdateMessage(plan.channel, plan.version, plan.manualPrefix)}`);
	};
	const script = await fetchInstaller(env.THINKRAIL_INSTALL_PS1_URL ?? DEFAULT_INSTALL_PS1_URL);
	if (script === undefined) {
		manual();
		return 1;
	}
	const run = await runPowerShellScript(script, plan.psArgs, { env });
	if (run === undefined) {
		console.error("error: no PowerShell found (looked for powershell.exe, then pwsh.exe)");
		manual();
		return 1;
	}
	if (run.exitCode !== 0) {
		console.error(`error: the installer exited with code ${run.exitCode}`);
		manual();
		return run.exitCode;
	}
	return 0;
}

export async function runUpdate(
	argv: readonly string[],
	env: Record<string, string | undefined>,
): Promise<number> {
	if (argv.includes("-h") || argv.includes("--help")) {
		console.log(UPDATE_USAGE);
		return 0;
	}
	const home = homedir();
	let plan: UpdatePlan | WindowsUpdatePlan;
	try {
		const input = {
			args: parseUpdateArgs(argv),
			installMeta: readInstallMeta(home),
			baked: bakedChannel,
			home,
		};
		plan =
			process.platform === "win32" ? resolveWindowsUpdatePlan(input) : resolveUpdatePlan(input);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${UPDATE_USAGE}`);
		return 1;
	}

	console.log(`Updating ThinkRail (current: ${version}, channel: ${plan.channel}) …`);

	if ("psArgs" in plan) return await runWindowsUpdate(plan, env);

	const url = env.THINKRAIL_INSTALL_SCRIPT_URL ?? DEFAULT_INSTALL_SCRIPT_URL;
	const fetched = Bun.spawnSync(["curl", "-fsSL", url], { stdout: "pipe", stderr: "inherit" });
	if (!fetched.success || fetched.stdout.length === 0) {
		console.error("error: failed to fetch the installer");
		return 1;
	}

	const run = Bun.spawnSync(["bash", ...plan.bashArgs], {
		stdin: fetched.stdout,
		stdout: "inherit",
		stderr: "inherit",
		env,
	});
	return run.exitCode ?? 1;
}
