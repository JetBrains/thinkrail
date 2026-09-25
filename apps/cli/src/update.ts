import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { channel as bakedChannel, version } from "@thinkrail/shared/version";
import {
	type InstallMeta,
	normalizeWindowsInstallPrefix,
	readInstallMeta,
	sameWindowsPath,
} from "./paths";
import { psQuote, runPowerShellScript } from "./powershell";

const DEFAULT_INSTALL_SCRIPT_URL =
	"https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh";
const GITHUB_RELEASES_URL = "https://api.github.com/repos/JetBrains/thinkrail/releases";
const RELEASE_CHECK_TIMEOUT_MS = 5_000;
const RELEASE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASE_CHECK_ERROR = "Unable to check for ThinkRail updates.";
const UPDATE_RUN_ERROR = "Unable to update ThinkRail.";
const STABLE_RELEASE_TAG_RE = /^v(\d+\.\d+\.\d+)$/;
const NIGHTLY_RELEASE_TAG_RE = /^v(\d+\.\d+\.\d+-nightly\.\d+)$/;
const SEMVER_RE =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const VERSION_RE = /^(?:latest|\d+\.\d+\.\d+(?:-nightly\.\d+)?)$/;
const PREFIX_FORBIDDEN_RE = /[;|&`$<>\n\r"'\\]/;
const WINDOWS_PREFIX_FORBIDDEN_RE = /["%;\n\r]/;

export const MANUAL_LAYOUT_UPDATE_ERROR =
	"This ThinkRail executable is outside the supported <prefix>/bin layout and cannot self-update safely. Reinstall it with the published installer, or replace it manually from https://github.com/JetBrains/thinkrail/releases";

export type ReleaseChannel = "stable" | "nightly";

export type ReleaseFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CliHostUpdateNotice {
	currentVersion: string;
	availableVersion: string;
	channel: ReleaseChannel;
}

export interface CliHostUpdate {
	intervalMs: number;
	check(): Promise<CliHostUpdateNotice | null>;
	run(): Promise<void>;
}

export type UpdateChildRunner = (command: readonly string[]) => Promise<number>;

const spawnUpdateChild: UpdateChildRunner = async (command) => {
	const child = Bun.spawn([...command], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return await child.exited;
};

function tagNameOf(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null || !("tag_name" in value)) return undefined;
	return typeof value.tag_name === "string" ? value.tag_name : undefined;
}

function versionFromTag(tag: string | undefined, pattern: RegExp): string | undefined {
	return tag?.match(pattern)?.[1];
}

export async function discoverReleaseVersion(
	channel: ReleaseChannel,
	fetchImpl: ReleaseFetch = fetch,
	timeoutMs = RELEASE_CHECK_TIMEOUT_MS,
): Promise<string> {
	const controller = new AbortController();
	const deadline = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const url =
			channel === "stable" ? `${GITHUB_RELEASES_URL}/latest` : `${GITHUB_RELEASES_URL}?per_page=20`;
		const response = await fetchImpl(url, {
			headers: { Accept: "application/vnd.github+json" },
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(RELEASE_CHECK_ERROR);
		const body: unknown = await response.json();
		if (channel === "stable") {
			const candidate = versionFromTag(tagNameOf(body), STABLE_RELEASE_TAG_RE);
			if (candidate !== undefined) return candidate;
		} else if (Array.isArray(body)) {
			for (const release of body) {
				const candidate = versionFromTag(tagNameOf(release), NIGHTLY_RELEASE_TAG_RE);
				if (candidate !== undefined) return candidate;
			}
		}
		throw new Error(RELEASE_CHECK_ERROR);
	} catch {
		throw new Error(RELEASE_CHECK_ERROR);
	} finally {
		clearTimeout(deadline);
	}
}

function isStrictlyNewerVersion(currentVersion: string, candidateVersion: string): boolean {
	if (!SEMVER_RE.test(currentVersion) || !SEMVER_RE.test(candidateVersion)) return false;
	return Bun.semver.order(currentVersion, candidateVersion) < 0;
}

export function createCliHostUpdate(
	build: string,
	baked: string,
	installedVersion: string,
	fetchImpl: ReleaseFetch = fetch,
	childRunner: UpdateChildRunner = spawnUpdateChild,
): CliHostUpdate | undefined {
	if (build !== "binary" || (baked !== "stable" && baked !== "nightly")) return undefined;
	return {
		intervalMs: RELEASE_CHECK_INTERVAL_MS,
		check: async () => {
			const availableVersion = await discoverReleaseVersion(baked, fetchImpl);
			if (!isStrictlyNewerVersion(installedVersion, availableVersion)) return null;
			return { currentVersion: installedVersion, availableVersion, channel: baked };
		},
		run: async () => {
			try {
				if ((await childRunner([process.execPath, "update"])) !== 0) {
					throw new Error(UPDATE_RUN_ERROR);
				}
			} catch {
				throw new Error(UPDATE_RUN_ERROR);
			}
		},
	};
}

export const UPDATE_USAGE = `Usage: thinkrail update [options]

Re-download and install the latest ThinkRail for the current channel.

Options:
  --channel stable|nightly   Override the channel (default: the installed channel).
  --version X.Y.Z|X.Y.Z-nightly.N|latest
                             Install a specific version (default: latest).
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
	platform: string;
	execPath: string;
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

function validateVersionChannel(version: string, channel: ReleaseChannel): void {
	if (version === "latest") return;
	const nightly = version.includes("-nightly.");
	if ((channel === "nightly") !== nightly) {
		throw new Error(`Version ${version} does not belong to the ${channel} channel`);
	}
}

function inferRunningPrefix(input: ResolveUpdateInput): string | undefined {
	const windows = input.platform === "win32";
	const path = windows ? win32 : posix;
	const exeName = windows ? "thinkrail.exe" : "thinkrail";
	if (path.basename(input.execPath) !== exeName) return undefined;
	const binDir = path.dirname(input.execPath);
	const binName = path.basename(binDir);
	if ((windows ? binName.toLowerCase() : binName) !== "bin" || !path.isAbsolute(input.execPath)) {
		throw new Error(MANUAL_LAYOUT_UPDATE_ERROR);
	}
	return path.dirname(binDir);
}

function unixMetadataPrefix(value: unknown, home: string): string {
	const prefix = typeof value === "string" && value ? value : posix.join(home, ".local");
	if (PREFIX_FORBIDDEN_RE.test(prefix) || !posix.isAbsolute(prefix)) {
		throw new Error(`Refusing suspicious install prefix from metadata: ${prefix}`);
	}
	return prefix;
}

function sameUnixPath(a: string, b: string): boolean {
	const normalized = (value: string) => posix.normalize(value).replace(/\/$/, "");
	return normalized(a) === normalized(b);
}

function trustedUnixMetadata(input: ResolveUpdateInput, runningPrefix: string): boolean {
	if (typeof input.installMeta.prefix !== "string" || !input.installMeta.prefix) return false;
	try {
		const prefix = unixMetadataPrefix(input.installMeta.prefix, input.home);
		return sameUnixPath(prefix, runningPrefix);
	} catch {
		return false;
	}
}

export function resolveUpdatePlan(input: ResolveUpdateInput): UpdatePlan {
	const runningPrefix = inferRunningPrefix(input);
	const trustMetadata = runningPrefix === undefined || trustedUnixMetadata(input, runningPrefix);
	const prefix = runningPrefix ?? unixMetadataPrefix(input.installMeta.prefix, input.home);
	const channel = resolveUpdateChannel(
		input.args,
		trustMetadata ? input.installMeta.channel : undefined,
		input.baked,
	);
	validateVersionChannel(input.args.version, channel);

	const bashArgs = ["-s", "--", "--channel", channel, "--prefix", prefix];
	if (input.args.version !== "latest") bashArgs.push("--version", input.args.version);
	return { channel, prefix, bashArgs };
}

const DEFAULT_INSTALL_PS1_URL =
	"https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1";

export function resolveWindowsInstallPrefix(metaPrefix: unknown, home: string): string {
	const rawPrefix =
		typeof metaPrefix === "string" && metaPrefix ? metaPrefix : win32.join(home, ".local");
	const prefix = normalizeWindowsInstallPrefix(rawPrefix);
	if (prefix === undefined || WINDOWS_PREFIX_FORBIDDEN_RE.test(prefix)) {
		throw new Error(`Refusing suspicious install prefix from metadata: ${rawPrefix}`);
	}
	return prefix;
}

export function resolveWindowsPrefix(metaPrefix: unknown, home: string): string | undefined {
	const prefix = resolveWindowsInstallPrefix(metaPrefix, home);
	const defaultPrefix = resolveWindowsInstallPrefix(undefined, home);
	return sameWindowsPath(prefix, defaultPrefix) ? undefined : prefix;
}

function trustedWindowsMetadata(input: ResolveUpdateInput, runningPrefix: string): boolean {
	if (typeof input.installMeta.prefix !== "string" || !input.installMeta.prefix) return false;
	try {
		const prefix = resolveWindowsInstallPrefix(input.installMeta.prefix, input.home);
		return sameWindowsPath(prefix, runningPrefix);
	} catch {
		return false;
	}
}

export interface WindowsUpdatePlan {
	channel: "stable" | "nightly";
	version: string;
	prefix: string;
	psArgs: string[];
	manualPrefix: string | undefined;
}

export function resolveWindowsUpdatePlan(input: ResolveUpdateInput): WindowsUpdatePlan {
	const runningPrefix = inferRunningPrefix(input);
	const trustMetadata = runningPrefix === undefined || trustedWindowsMetadata(input, runningPrefix);
	const prefix = runningPrefix
		? resolveWindowsInstallPrefix(runningPrefix, input.home)
		: resolveWindowsInstallPrefix(input.installMeta.prefix, input.home);
	const channel = resolveUpdateChannel(
		input.args,
		trustMetadata ? input.installMeta.channel : undefined,
		input.baked,
	);
	const version = input.args.version;
	validateVersionChannel(version, channel);
	return {
		channel,
		version,
		prefix,
		psArgs: ["-Channel", channel, "-Version", version, "-Prefix", prefix],
		manualPrefix: sameWindowsPath(prefix, resolveWindowsInstallPrefix(undefined, input.home))
			? undefined
			: prefix,
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
			platform: process.platform,
			execPath: process.execPath,
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
