// `thinkrail uninstall` — the inverse of install.sh / install.ps1, and only of them: the executable, the
// PATH edit the installer made, `install.json`, and the cache the compiled binary self-extracts into. The
// user's app state (the data dir) is a separate question the command *asks*, and keeps by default: it
// holds the workspace git worktrees, so deleting it can destroy uncommitted work. pi's own state (`~/.pi`:
// auth, models, sessions) is never touched — it isn't ours to remove.
//
// Shape: a pure plan (`resolveUninstallTargets`) → an inspection pass that narrows it to what really
// exists, so the printed plan is true → the prompts → the removals, each reported.

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

/** The marker block install.sh writes into a shell rc file — self-identifying, so removing it is safe. */
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
	/** Skip every prompt. */
	yes: boolean;
	/** An explicit answer to the app-state question, or `undefined` to ask. */
	data: "keep" | "remove" | undefined;
	help: boolean;
}

/** Parse `uninstall`'s argv (the slice after `uninstall`). Throws on an unknown or contradictory flag. */
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

/** Answer to a `[y/N]` question: an empty (or unrecognized) answer keeps the offered default. */
export function parseYesNo(answer: string, fallback: boolean): boolean {
	const normalized = answer.trim().toLowerCase();
	if (normalized === "y" || normalized === "yes") return true;
	if (normalized === "n" || normalized === "no") return false;
	return fallback;
}

/**
 * Ask a `[y/N]` question, reading from the interface's **line iterator** rather than `rl.question`: the
 * iterator is attached once and buffers, so an answer typed ahead of the second prompt is still read (and
 * `question`'s promise never settles on EOF at all — the command would exit silently having done nothing,
 * the one outcome an uninstall must never have). A closed stdin (Ctrl+D) counts as the default answer.
 */
async function askYesNo(
	rl: ReturnType<typeof createInterface>,
	lines: AsyncIterator<string>,
	question: string,
	fallback: boolean,
): Promise<boolean> {
	// Via the interface, not a bare write, so line editing redraws the prompt with it.
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
	/** Executables to remove: the recorded install, plus our own binary when it is one. Deduped. */
	binaries: string[];
	/** `<prefix>/bin` — the dir the installer puts on PATH. */
	binDir: string;
	/**
	 * Windows: did *our* installer put `binDir` on the user PATH (`install.json`'s `path_entry_added`, for
	 * this same prefix)? The only thing that licenses a registry PATH edit — see `removeWindowsPathEntry`.
	 */
	pathEntryOwned: boolean;
	/** Shell rc files that may carry the installer's block (Unix). */
	rcFiles: string[];
	/** The fish `conf.d` snippet install.sh creates — deleted outright once only the block is left. */
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
	/** `process.execPath` — the compiled binary when we *are* one, else the Bun/Node runtime. */
	execPath: string;
	dataDir: string;
	stagingRoot: string;
}

/**
 * The paths an uninstall touches — pure, so every rule below is unit-testable.
 *
 * The prefix comes from `install.json`, else the installers' own `~/.local` default; a relative or empty
 * recorded prefix is ignored rather than trusted. Beyond that we add `process.execPath` **when it is
 * itself a `thinkrail` binary** — that is what covers a custom-prefix install whose `install.json` is
 * gone — and nothing else is ever a candidate, whatever the metadata says.
 */
export function resolveUninstallTargets(input: ResolveUninstallInput): UninstallTargets {
	const windows = input.platform === "win32";
	const exeName = windows ? "thinkrail.exe" : "thinkrail";
	const recordedPrefix = input.installMeta.prefix;
	const prefix =
		typeof recordedPrefix === "string" && isAbsolutePath(recordedPrefix, windows)
			? recordedPrefix
			: join(input.home, ".local");
	const binDir = join(prefix, "bin");

	// Only the recorded flag proves the entry is ours, and only for the prefix it was recorded against: a
	// fallback prefix means we are not looking at the install that flag describes.
	const pathEntryOwned =
		windows && prefix === recordedPrefix && input.installMeta.path_entry_added === true;

	const binaries = [join(binDir, exeName)];
	if (basename(input.execPath) === exeName && !binaries.includes(input.execPath)) {
		binaries.push(input.execPath);
	}

	// Every rc file install.sh could have written, plus `.profile`/`.zshrc` regardless of `$SHELL` and
	// `$ZDOTDIR` — the block is self-identifying, so scanning a file we never wrote costs nothing and
	// catches a user who has since switched shells. (install.sh never writes one on Windows.)
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

/** `path.isAbsolute` for the *target* platform, not ours (this module is unit-tested cross-platform). */
function isAbsolutePath(path: string, windows: boolean): boolean {
	return windows ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/.test(path) : path.startsWith("/");
}

/**
 * Strip the installer's PATH block from an rc file's contents. Mirrors install.sh's own awk strip (drop
 * `begin`..`end` inclusive) and additionally drops the single blank line install.sh printed before the
 * block, so an uninstall leaves the file as it found it.
 *
 * `unterminated` means a `begin` marker with no `end` after it: the caller must then leave the file alone
 * — a hand-edited or truncated rc file is not worth silently rewriting.
 */
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

/**
 * Remove `$Dir` from the persistent per-user PATH — the exact inverse of install.ps1's
 * `Add-ThinkRailToUserPath`, and PowerShell for the same reasons it is: the registry value's
 * `REG_EXPAND_SZ` kind must survive (`[Environment]::SetEnvironmentVariable` would rewrite it as `REG_SZ`
 * and expand every other tool's `%VARS%`), entries must be compared both raw and expanded, and the value
 * must never cross a pipe — a non-ASCII entry would come back mangled in the console code page. Prints
 * one token: `removed`, `absent`, or `failed`.
 */
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

/** What a step acted on. Typed rather than free text: the closing advice keys off `PATH entry`. */
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

/**
 * Remove an executable that may be *this* process. Unix unlinks a running binary happily; Windows refuses
 * to delete a locked image but does allow renaming it, so we rename it to the very `thinkrail.exe.*.old`
 * name install.ps1's own cleanup already sweeps, then let a detached PowerShell retry the delete once
 * we've exited. Either way the report says what, if anything, is left behind.
 */
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
		// Retry for ~20s: the delete can only start succeeding once this process is gone.
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

/** Strip the installer's block from the rc files that carry it (Unix). */
function removeRcBlocks(targets: UninstallTargets): Step[] {
	const steps: Step[] = [];
	for (const file of rcCandidates(targets)) {
		let content: string;
		try {
			content = readFileSync(file, "utf8");
		} catch {
			continue; // Not there (or not readable) — nothing of ours to undo.
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
				// A file install.sh created for us alone: with the block gone, so is its reason to exist.
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

/**
 * Remove `<prefix>\bin` from the user PATH (Windows). Gated on install.ps1 having *recorded that it added
 * that entry*: unlike install.sh's marker block, a registry PATH entry carries nothing that says it is
 * ours, and a user who already had that dir on PATH for other tools must not lose it because ThinkRail
 * happened to be installed there too. Being installed is not the same as having added the entry —
 * `-NoModifyPath`, an entry that was already present, a failed registry write and a Git-Bash install.sh
 * install all record an install without touching the Windows PATH, and legacy metadata predates the flag.
 */
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

/** Sweep the `.old`/`.new` leftovers a Windows install/update pair can leave beside the exe. */
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
		// A leftover that is still locked (an older copy someone is running, or the one we just renamed
		// ourselves out of) is not this uninstall's problem — only report the ones that went.
		if (removeFile(path) === "removed") steps.push(step("leftover", path, "removed"));
	}
	return steps;
}

function rcCandidates(targets: UninstallTargets): string[] {
	return targets.fishFile ? [...targets.rcFiles, targets.fishFile] : targets.rcFiles;
}

/** Which of the plan's PATH edits are really there: an rc file carrying the block, or the Windows entry. */
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

/** The plan as printed before anything is touched — only what exists, so what it says can be trusted. */
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

/** Run the `uninstall` subcommand. Returns a process exit code. */
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
		// Ours, but only while it's empty — another tool's `~/.config/thinkrail` file is not ours to drop.
		rmdirSync(targets.installConfigDir);
	} catch {
		// Missing or not empty: nothing to do either way.
	}
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
