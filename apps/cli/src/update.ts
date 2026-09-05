import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { compareReleaseVersions, resolveLatestRelease } from "@thinkrail/shared/release";
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

const INSTALLER_FETCH_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;

async function fetchInstaller(url: string): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(INSTALLER_FETCH_TIMEOUT_MS) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const script = await response.text();
	if (!script.trim()) throw new Error("empty response");
	return script;
}

export type UpdateExecution =
	| { kind: "ok"; output: string }
	| { kind: "manual"; reason: string; command: string; exitCode: number }
	| { kind: "failed"; reason: string; output: string; exitCode: number };

function failureText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export interface BoundedChild {
	exitCode: number;
	output: string;
	timedOut: boolean;
}

const KILL_GRACE_MS = 2_000;
const DRAIN_GRACE_MS = 3_000;

function killTree(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {}
	}
}

export function runInstallerScript(
	script: ArrayBufferLike | string,
	args: readonly string[],
	options: { env: Record<string, string | undefined>; capture: boolean; timeoutMs: number },
): Promise<BoundedChild> {
	const child = spawn("bash", [...args], {
		detached: true,
		env: options.env,
		stdio: ["pipe", options.capture ? "pipe" : "inherit", options.capture ? "pipe" : "inherit"],
	});
	return new Promise<BoundedChild>((resolve) => {
		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});

		let settled = false;
		let expired = false;
		const settle = (exitCode: number): void => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			resolve({ exitCode, output, timedOut: expired });
		};

		const deadline = setTimeout(() => {
			expired = true;
			const pid = child.pid;
			if (pid !== undefined) {
				killTree(pid, "SIGTERM");
				const forced = setTimeout(() => killTree(pid, "SIGKILL"), KILL_GRACE_MS);
				forced.unref?.();
			}
			const abandon = setTimeout(() => settle(124), DRAIN_GRACE_MS);
			abandon.unref?.();
		}, options.timeoutMs);
		deadline.unref?.();

		child.once("error", () => settle(1));
		child.once("close", (code) => settle(code ?? 124));

		child.stdin?.on("error", () => {});
		child.stdin?.end(script instanceof ArrayBuffer ? Buffer.from(script) : script);
	});
}

export interface ExecuteUpdateOptions {
	env: Record<string, string | undefined>;
	capture?: boolean;
}

async function executeWindowsPlan(
	plan: WindowsUpdatePlan,
	options: ExecuteUpdateOptions,
): Promise<UpdateExecution> {
	const manual = (reason: string, exitCode: number): UpdateExecution => ({
		kind: "manual",
		reason,
		command: windowsManualUpdateMessage(plan.channel, plan.version, plan.manualPrefix),
		exitCode,
	});

	let script: string;
	try {
		script = await fetchInstaller(options.env.THINKRAIL_INSTALL_PS1_URL ?? DEFAULT_INSTALL_PS1_URL);
	} catch (err) {
		return manual(`failed to fetch the installer (${failureText(err)})`, 1);
	}

	const run = await runPowerShellScript(script, plan.psArgs, {
		env: options.env,
		timeoutMs: INSTALL_TIMEOUT_MS,
		...(options.capture ? { capture: true } : {}),
	});
	if (run === undefined) {
		return manual("no PowerShell found (looked for powershell.exe, then pwsh.exe)", 1);
	}
	if (run.timedOut) {
		return manual(`the installer did not finish within ${INSTALL_TIMEOUT_MS / 60_000} minutes`, 1);
	}
	if (run.exitCode !== 0) {
		return manual(`the installer exited with code ${run.exitCode}`, run.exitCode);
	}
	return { kind: "ok", output: run.stdout };
}

async function executeUnixPlan(
	plan: UpdatePlan,
	options: ExecuteUpdateOptions,
): Promise<UpdateExecution> {
	const url = options.env.THINKRAIL_INSTALL_SCRIPT_URL ?? DEFAULT_INSTALL_SCRIPT_URL;
	const fetched = Bun.spawn(
		["curl", "-fsSL", "--max-time", String(INSTALLER_FETCH_TIMEOUT_MS / 1000), url],
		{ stdout: "pipe", stderr: "inherit" },
	);
	const script = await new Response(fetched.stdout).arrayBuffer();
	if ((await fetched.exited) !== 0 || script.byteLength === 0) {
		return { kind: "failed", reason: "failed to fetch the installer", output: "", exitCode: 1 };
	}

	const { exitCode, output, timedOut } = await runInstallerScript(script, plan.bashArgs, {
		env: options.env,
		capture: options.capture === true,
		timeoutMs: INSTALL_TIMEOUT_MS,
	});
	if (timedOut) {
		return {
			kind: "failed",
			reason: `the installer did not finish within ${INSTALL_TIMEOUT_MS / 60_000} minutes`,
			output,
			exitCode,
		};
	}
	if (exitCode !== 0) {
		return {
			kind: "failed",
			reason: `the installer exited with code ${exitCode}`,
			output,
			exitCode,
		};
	}
	return { kind: "ok", output };
}

export function alreadyNewest(input: {
	current: string;
	latest: string | undefined;
	installedChannel: "stable" | "nightly";
	targetChannel: "stable" | "nightly";
}): boolean {
	if (input.latest === undefined) return false;
	if (input.targetChannel !== input.installedChannel) return false;
	return compareReleaseVersions(input.current, input.latest) >= 0;
}

export function executeUpdatePlan(
	plan: UpdatePlan | WindowsUpdatePlan,
	options: ExecuteUpdateOptions,
): Promise<UpdateExecution> {
	return "psArgs" in plan ? executeWindowsPlan(plan, options) : executeUnixPlan(plan, options);
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
	let wanted: string;
	let installedChannel: "stable" | "nightly";
	try {
		const args = parseUpdateArgs(argv);
		wanted = args.version;
		const installMeta = readInstallMeta(home);
		installedChannel = resolveUpdateChannel(
			{ version: "latest" },
			installMeta.channel,
			bakedChannel,
		);
		const input = { args, installMeta, baked: bakedChannel, home };
		plan =
			process.platform === "win32" ? resolveWindowsUpdatePlan(input) : resolveUpdatePlan(input);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${UPDATE_USAGE}`);
		return 1;
	}

	console.log(`Updating ThinkRail (current: ${version}, channel: ${plan.channel}) …`);

	if (wanted === "latest") {
		try {
			const latest = await resolveLatestRelease(plan.channel, { env });
			if (latest) console.log(`Newest ${plan.channel} build: ${latest.version}`);
			if (
				alreadyNewest({
					current: version,
					latest: latest?.version,
					installedChannel,
					targetChannel: plan.channel,
				})
			) {
				console.log(`Already on the newest ${plan.channel} build (${version}).`);
				return 0;
			}
		} catch (err) {
			console.error(`warning: could not check the newest release (${failureText(err)})`);
		}
	}

	const execution = await executeUpdatePlan(plan, { env });
	if (execution.kind === "ok") return 0;
	console.error(`error: ${execution.reason}`);
	if (execution.kind === "manual") console.error(`\n${execution.command}`);
	return execution.exitCode;
}
