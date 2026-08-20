import { randomUUID } from "node:crypto";
import {
	existsSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { dataDir } from "@thinkrail/server";
import {
	type InstallMeta,
	installConfigDir,
	installMetaFile,
	readInstallMeta,
	stagingRoot,
} from "./paths";
import { psQuote, runPowerShellScript, spawnDetachedPowerShell } from "./powershell";
import { channel, version } from "./version";

export const RC_BLOCK_BEGIN = "# >>> thinkrail PATH >>>";
export const RC_BLOCK_END = "# <<< thinkrail PATH <<<";

export const UNINSTALL_USAGE = `Usage: thinkrail uninstall [options]

Remove ThinkRail from this machine: the executable, the installer's PATH entry, the install
metadata, and the binary's staging cache. Your app state (~/.thinkrail) is kept unless you ask
for it to be removed. pi's own state (~/.pi) is never touched.

Options:
  --remove-data   Also delete the app state dir — projects, workspaces, and the git worktrees
                  under it, including any uncommitted work in them.
  --keep-data     Keep the app state dir (the default; skips the question).
  -y, --yes       Don't ask anything (required when stdin isn't a terminal; keeps the app state
                  unless --remove-data says otherwise).
  -h, --help      Show this help.`;

export interface UninstallArgs {
	yes: boolean;
	data: "keep" | "remove" | undefined;
	help: boolean;
}

export function parseUninstallArgs(argv: readonly string[]): UninstallArgs {
	let yes = false;
	let data: "keep" | "remove" | undefined;
	let help = false;
	for (const arg of argv) {
		if (arg === "-y" || arg === "--yes") {
			yes = true;
		} else if (arg === "-h" || arg === "--help") {
			help = true;
		} else if (arg === "--remove-data" || arg === "--keep-data") {
			const next = arg === "--remove-data" ? "remove" : "keep";
			if (data !== undefined && data !== next) {
				throw new Error("--keep-data and --remove-data are mutually exclusive");
			}
			data = next;
		} else {
			throw new Error(`Unknown option: ${arg}`);
		}
	}
	return { yes, data, help };
}

export function parseYesNo(answer: string, fallback: boolean): boolean {
	const normalized = answer.trim().toLowerCase();
	if (normalized === "y" || normalized === "yes") return true;
	if (normalized === "n" || normalized === "no") return false;
	return fallback;
}

async function askYesNo(
	rl: ReturnType<typeof createInterface>,
	lines: AsyncIterator<string>,
	question: string,
	fallback: boolean,
): Promise<boolean> {
	rl.setPrompt(question);
	rl.prompt();
	const next = await lines.next();
	if (next.done) {
		process.stdout.write("\n");
		return fallback;
	}
	return parseYesNo(next.value, fallback);
}

export interface UninstallTargets {
	binaries: string[];
	binDir: string;
	pathEntryOwned: boolean;
	rcFiles: string[];
	fishFile: string;
	installMetaFile: string;
	installConfigDir: string;
	stagingRoot: string;
	dataDir: string;
}

export interface ResolveUninstallInput {
	platform: string;
	home: string;
	env: Record<string, string | undefined>;
	installMeta: InstallMeta;
	execPath: string;
	dataDir: string;
	stagingRoot: string;
}

export function resolveUninstallTargets(input: ResolveUninstallInput): UninstallTargets {
	const windows = input.platform === "win32";
	const exeName = windows ? "thinkrail.exe" : "thinkrail";
	const recordedPrefix = input.installMeta.prefix;
	const prefix =
		typeof recordedPrefix === "string" && isAbsolutePath(recordedPrefix, windows)
			? recordedPrefix
			: join(input.home, ".local");
	const binDir = join(prefix, "bin");

	const pathEntryOwned =
		windows && prefix === recordedPrefix && input.installMeta.path_entry_added === true;

	const binaries = [join(binDir, exeName)];
	if (basename(input.execPath) === exeName && !binaries.includes(input.execPath)) {
		binaries.push(input.execPath);
	}

	const zdotdir = input.env.ZDOTDIR;
	const rcFiles = windows
		? []
		: [
				...new Set([
					join(input.home, ".bashrc"),
					join(input.home, ".bash_profile"),
					join(input.home, ".profile"),
					join(input.home, ".zshrc"),
					...(zdotdir ? [join(zdotdir, ".zshrc")] : []),
				]),
			];

	return {
		binaries,
		binDir,
		pathEntryOwned,
		rcFiles,
		fishFile: windows ? "" : join(input.home, ".config", "fish", "conf.d", "thinkrail.fish"),
		installMetaFile: installMetaFile(input.home),
		installConfigDir: installConfigDir(input.home),
		stagingRoot: input.stagingRoot,
		dataDir: input.dataDir,
	};
}

function isAbsolutePath(path: string, windows: boolean): boolean {
	return windows ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/.test(path) : path.startsWith("/");
}

export function stripRcPathBlock(content: string): {
	next: string;
	removed: boolean;
	unterminated: boolean;
} {
	const kept: string[] = [];
	let removed = false;
	let skipping = false;
	for (const line of content.split("\n")) {
		if (skipping) {
			if (line.trim() === RC_BLOCK_END) skipping = false;
			continue;
		}
		if (line.trim() === RC_BLOCK_BEGIN) {
			skipping = true;
			removed = true;
			if (kept.at(-1) === "") kept.pop();
			continue;
		}
		kept.push(line);
	}
	if (skipping) return { next: content, removed: false, unterminated: true };
	return { next: kept.join("\n"), removed, unterminated: false };
}

const REMOVE_FROM_USER_PATH_PS1 = String.raw`param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = 'Stop'

function Get-NormalizedEntry([string]$p) { return $p.Replace('/', '\').TrimEnd('\') }

function Get-PathWithoutEntry {
    # The decision half, kept a pure function of its inputs: the ';'-delimited value minus every entry
    # naming $Dir, compared raw *and* %VAR%-expanded (install.ps1 appends the prefix literally, but the
    # entry that was already there may be written either way), separator- and case-insensitively. Every
    # other entry -- an empty one included -- is kept verbatim, so the value is otherwise what it was.
    # $null means "nothing named $Dir", which is not the same as the empty string (PATH was only us).
    param([string]$Raw, [string]$Dir)
    $target = Get-NormalizedEntry $Dir
    $kept = @()
    $removed = $false
    foreach ($entry in ($Raw -split ';')) {
        $e = Get-NormalizedEntry $entry.Trim()
        if ($e) {
            $expanded = Get-NormalizedEntry ([System.Environment]::ExpandEnvironmentVariables($e))
            if (($e -ieq $target) -or ($expanded -ieq $target)) { $removed = $true; continue }
        }
        $kept += $entry
    }
    if (-not $removed) { return $null }
    return ($kept -join ';')
}

function Send-ThinkRailSettingChange {
    # Broadcast WM_SETTINGCHANGE "Environment" so terminals opened after this see the new PATH without a
    # sign-out (the same best-effort call install.ps1 makes after adding the entry).
    try {
        if (-not ('ThinkRail.NativeMethods' -as [type])) {
            Add-Type -Namespace ThinkRail -Name NativeMethods -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
        }
        $result = [UIntPtr]::Zero
        [void][ThinkRail.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
    } catch {
        # Non-fatal: the registry is already updated; new terminals see it after the next sign-in.
    }
}

$key = $null
try {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
    if (-not $key) { 'failed'; return }
    if (@($key.GetValueNames()) -notcontains 'Path') { 'absent'; return }
    $kind = $key.GetValueKind('Path')
    $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $next = Get-PathWithoutEntry -Raw $raw -Dir $Dir
    if ($null -eq $next) { 'absent'; return }
    $key.SetValue('Path', $next, $kind)
    Send-ThinkRailSettingChange
    'removed'
} catch {
    'failed'
} finally {
    if ($key) { $key.Dispose() }
}
`;

type Outcome = "removed" | "kept" | "absent" | "failed";

type StepKind =
	| "executable"
	| "leftover"
	| "PATH entry"
	| "install info"
	| "staging cache"
	| "app state";

interface Step {
	kind: StepKind;
	path: string;
	outcome: Outcome;
	detail?: string;
}

function step(kind: StepKind, path: string, outcome: Outcome, detail?: string): Step {
	return { kind, path, outcome, ...(detail ? { detail } : {}) };
}

function isMissing(err: unknown): boolean {
	return (err as { code?: string } | null)?.code === "ENOENT";
}

function removeFile(path: string): Outcome {
	try {
		unlinkSync(path);
		return "removed";
	} catch (err) {
		return isMissing(err) ? "absent" : "failed";
	}
}

function removeTree(path: string): Outcome {
	if (!existsSync(path)) return "absent";
	try {
		rmSync(path, { recursive: true, force: true });
		return "removed";
	} catch {
		return "failed";
	}
}

function removeExecutable(path: string): Step {
	try {
		unlinkSync(path);
		return step("executable", path, "removed");
	} catch (err) {
		if (isMissing(err)) return step("executable", path, "absent");
		if (process.platform !== "win32") {
			return step("executable", path, "failed", err instanceof Error ? err.message : String(err));
		}
		const aside = `${path}.${randomUUID().slice(0, 8)}.old`;
		try {
			renameSync(path, aside);
		} catch {
			return step(
				"executable",
				path,
				"failed",
				"it is locked by a running ThinkRail — close it and try again",
			);
		}
		const quoted = psQuote(aside);
		const scheduled = spawnDetachedPowerShell(
			`for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; Remove-Item -LiteralPath ${quoted} -Force -ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath ${quoted})) { break } }`,
		);
		return step(
			"executable",
			path,
			"removed",
			scheduled
				? `Windows can't delete a running program: renamed to ${basename(aside)}, which goes once no ThinkRail is running`
				: `Windows can't delete a running program: renamed to ${aside} — delete that file by hand`,
		);
	}
}

function removeRcBlocks(targets: UninstallTargets): Step[] {
	const steps: Step[] = [];
	for (const file of rcCandidates(targets)) {
		let content: string;
		try {
			content = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		if (!content.includes(RC_BLOCK_BEGIN)) continue;
		const { next, removed, unterminated } = stripRcPathBlock(content);
		if (unterminated) {
			steps.push(
				step(
					"PATH entry",
					file,
					"failed",
					`its "${RC_BLOCK_BEGIN}" block has no end marker — remove those lines by hand`,
				),
			);
			continue;
		}
		if (!removed) continue;
		try {
			if (file === targets.fishFile && next.trim() === "") {
				unlinkSync(file);
				steps.push(step("PATH entry", file, "removed"));
			} else {
				writeFileSync(file, next);
				steps.push(step("PATH entry", file, "removed", `the "${RC_BLOCK_BEGIN}" block`));
			}
		} catch (err) {
			steps.push(
				step("PATH entry", file, "failed", err instanceof Error ? err.message : String(err)),
			);
		}
	}
	return steps;
}

async function removeWindowsPathEntry(targets: UninstallTargets): Promise<Step> {
	if (!targets.pathEntryOwned) {
		return step(
			"PATH entry",
			targets.binDir,
			"kept",
			"the installer never added it (or can't prove it did) — check your PATH by hand",
		);
	}
	const run = await runPowerShellScript(REMOVE_FROM_USER_PATH_PS1, ["-Dir", targets.binDir], {
		capture: true,
	});
	if (run === undefined) {
		return step(
			"PATH entry",
			targets.binDir,
			"failed",
			"no PowerShell found (looked for powershell.exe, then pwsh.exe)",
		);
	}
	const token = run.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (token === "removed")
		return step("PATH entry", targets.binDir, "removed", "from your user PATH");
	if (token === "absent")
		return step("PATH entry", targets.binDir, "absent", "not in your user PATH");
	return step("PATH entry", targets.binDir, "failed", "could not update HKCU\\Environment");
}

function removeWindowsLeftovers(targets: UninstallTargets): Step[] {
	if (process.platform !== "win32") return [];
	let entries: string[];
	try {
		entries = readdirSync(targets.binDir);
	} catch {
		return [];
	}
	const steps: Step[] = [];
	for (const entry of entries) {
		if (!entry.startsWith("thinkrail.exe.")) continue;
		if (!entry.endsWith(".old") && !entry.endsWith(".new")) continue;
		const path = join(targets.binDir, entry);
		if (removeFile(path) === "removed") steps.push(step("leftover", path, "removed"));
	}
	return steps;
}

function rcCandidates(targets: UninstallTargets): string[] {
	return targets.fishFile ? [...targets.rcFiles, targets.fishFile] : targets.rcFiles;
}

function findPathEdits(targets: UninstallTargets): string[] {
	if (process.platform === "win32") return targets.pathEntryOwned ? [targets.binDir] : [];
	return rcCandidates(targets).filter((file) => {
		try {
			return readFileSync(file, "utf8").includes(RC_BLOCK_BEGIN);
		} catch {
			return false;
		}
	});
}

function describePlan(
	targets: UninstallTargets,
	present: { binaries: string[]; pathEdits: string[] },
	dataNote: string,
): string {
	const rows: Array<[string, string]> = [];
	for (const binary of present.binaries) rows.push(["executable", binary]);
	for (const edit of present.pathEdits) rows.push(["PATH entry", edit]);
	if (existsSync(targets.installMetaFile)) rows.push(["install info", targets.installMetaFile]);
	if (existsSync(targets.stagingRoot)) rows.push(["staging cache", targets.stagingRoot]);
	if (existsSync(targets.dataDir)) rows.push(["app state", `${targets.dataDir} (${dataNote})`]);
	const width = Math.max(0, ...rows.map(([label]) => label.length));
	const body = rows.length
		? rows.map(([label, path]) => `  ${label.padEnd(width)}  ${path}`).join("\n")
		: "  (nothing found — ThinkRail doesn't look installed from here)";
	return `thinkrail ${version} (${channel}) — uninstall\n\n${body}\n`;
}

const OUTCOME_WORD: Record<Outcome, string> = {
	removed: "removed",
	kept: "kept",
	absent: "not found",
	failed: "FAILED",
};

function printSteps(steps: Step[]): void {
	for (const item of steps) {
		const detail = item.detail ? ` — ${item.detail}` : "";
		console.log(`  ${OUTCOME_WORD[item.outcome].padEnd(9)}  ${item.path}${detail}`);
	}
}

export async function runUninstall(
	argv: readonly string[],
	env: Record<string, string | undefined>,
): Promise<number> {
	let args: UninstallArgs;
	try {
		args = parseUninstallArgs(argv);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${UNINSTALL_USAGE}`);
		return 1;
	}
	if (args.help) {
		console.log(UNINSTALL_USAGE);
		return 0;
	}

	const home = homedir();
	const targets = resolveUninstallTargets({
		platform: process.platform,
		home,
		env,
		installMeta: readInstallMeta(home),
		execPath: process.execPath,
		dataDir: dataDir(),
		stagingRoot: stagingRoot(),
	});

	let removeData = args.data === "remove";
	console.log(
		describePlan(
			targets,
			{
				binaries: targets.binaries.filter((path) => existsSync(path)),
				pathEdits: findPathEdits(targets),
			},
			args.data === undefined ? "kept unless you say otherwise" : removeData ? "DELETE" : "keep",
		),
	);

	if (!args.yes) {
		if (!process.stdin.isTTY) {
			console.error(
				"error: uninstall needs a terminal to confirm — re-run with --yes (plus --remove-data to delete the app state too).",
			);
			return 1;
		}
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		const lines = rl[Symbol.asyncIterator]();
		try {
			if (args.data === undefined && existsSync(targets.dataDir)) {
				console.log(
					`Your app state at ${targets.dataDir} holds your projects, workspaces, and the git\nworktrees under them — deleting it destroys any uncommitted work in those worktrees.`,
				);
				removeData = await askYesNo(rl, lines, "Delete it too? [y/N] ", false);
			}
			const question = removeData
				? "Uninstall ThinkRail and delete the app state? [y/N] "
				: "Uninstall ThinkRail (keeping the app state)? [y/N] ";
			if (!(await askYesNo(rl, lines, question, false))) {
				console.log("\nAborted — nothing was removed.");
				return 0;
			}
		} finally {
			rl.close();
		}
		console.log("");
	}

	const steps: Step[] = [];
	for (const binary of targets.binaries) steps.push(removeExecutable(binary));
	steps.push(...removeWindowsLeftovers(targets));
	steps.push(
		...(process.platform === "win32"
			? [await removeWindowsPathEntry(targets)]
			: removeRcBlocks(targets)),
	);
	steps.push(step("install info", targets.installMetaFile, removeFile(targets.installMetaFile)));
	try {
		rmdirSync(targets.installConfigDir);
	} catch {}
	steps.push(step("staging cache", targets.stagingRoot, removeTree(targets.stagingRoot)));
	steps.push(
		step(
			"app state",
			targets.dataDir,
			removeData ? removeTree(targets.dataDir) : existsSync(targets.dataDir) ? "kept" : "absent",
		),
	);

	printSteps(steps);
	console.log("");

	const failed = steps.filter((item) => item.outcome === "failed");
	console.log(
		failed.length
			? `Uninstall finished with ${failed.length} problem(s) — see FAILED above.`
			: "ThinkRail is uninstalled.",
	);
	if (steps.some((item) => item.kind === "PATH entry" && item.outcome === "removed")) {
		console.log("Open a new terminal for the PATH change to take effect.");
	}
	if (removeData) {
		console.log(
			"The workspace worktrees are gone with it — run `git worktree prune` in the repos you used if git still lists them.",
		);
	} else if (existsSync(targets.dataDir)) {
		console.log(
			`Your app state is still at ${targets.dataDir} — delete it by hand if you're done.`,
		);
	}
	console.log("pi's own state (~/.pi: auth, models, sessions) was left alone.");
	return failed.length ? 1 : 0;
}
