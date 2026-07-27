// Native directory picker, run on the host (the machine the repos live on). One picker per OS
// (macOS `osascript`, Linux `zenity`/`kdialog`, Windows PowerShell); `THINKRAIL_PICK_DIR`
// overrides it so the flow is drivable headlessly in dev/e2e.

import { readFileSync, statSync } from "node:fs";

/** A candidate native picker: the command to spawn + how to read a chosen path from its stdout. */
export interface Picker {
	cmd: string[];
	/** Map raw stdout to an absolute path, or `null` when nothing usable was returned. */
	parse: (stdout: string) => string | null;
	/**
	 * What a non-zero exit means. `osascript` (-128), `zenity` and `kdialog` exit non-zero when the user
	 * cancels; PowerShell exits **0** and prints nothing, so there it's a real failure, not a cancel.
	 */
	nonZeroExit: "cancel" | "error";
}

// Trim surrounding whitespace and any trailing path separator(s); empty → null. Shared across
// platforms — macOS returns a trailing-slash POSIX path, Windows backslashes, zenity/kdialog neither.
const toPath = (stdout: string): string | null => stdout.trim().replace(/[/\\]+$/, "") || null;

// PowerShell folder picker: a WinForms FolderBrowserDialog; prints the path on OK, nothing on cancel.
// The dialog is **owned by an invisible top-most form**: we spawn it from a background process, which
// Windows forbids from taking the foreground, so an unowned dialog opens *behind* the browser the user
// is looking at — indistinguishable from "the button does nothing". `$ErrorActionPreference = 'Stop'`
// turns a blocked `Add-Type`/`New-Object` (ConstrainedLanguage mode on a locked-down host) into a
// non-zero exit with a real message on stderr, instead of printing nothing and looking like a cancel.
const WINDOWS_PICKER = [
	"$ErrorActionPreference = 'Stop'",
	"Add-Type -AssemblyName System.Windows.Forms",
	"$owner = New-Object System.Windows.Forms.Form",
	"$owner.TopMost = $true",
	"$owner.ShowInTaskbar = $false",
	"$owner.Opacity = 0",
	"$owner.Show()",
	"$d = New-Object System.Windows.Forms.FolderBrowserDialog",
	"$d.Description = 'Open project'",
	"$ok = $d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK",
	"$owner.Close()",
	"if ($ok) { Write-Output $d.SelectedPath }",
].join("; ");

/**
 * The ordered native pickers to try for a platform. Multiple entries are fallbacks tried only when the
 * binary is absent (Linux: zenity, then kdialog); an empty list means no native picker for this OS.
 */
export function pickersFor(platform: NodeJS.Platform): Picker[] {
	switch (platform) {
		case "darwin":
			return [
				{
					cmd: ["osascript", "-e", 'POSIX path of (choose folder with prompt "Open project")'],
					parse: toPath,
					nonZeroExit: "cancel",
				},
			];
		case "linux":
			return [
				{
					cmd: ["zenity", "--file-selection", "--directory", "--title=Open project"],
					parse: toPath,
					nonZeroExit: "cancel",
				},
				{
					cmd: ["kdialog", "--getexistingdirectory", ".", "--title", "Open project"],
					parse: toPath,
					nonZeroExit: "cancel",
				},
			];
		case "win32":
			// The same two hosts (and order) `apps/cli/src/powershell.ts` uses. `-Sta` because a WinForms
			// dialog needs a single-threaded apartment: both hosts already default to STA on Windows, so this
			// only pins the requirement at the spawn site.
			return ["powershell.exe", "pwsh.exe"].map((shell) => ({
				cmd: [shell, "-NoProfile", "-Sta", "-Command", WINDOWS_PICKER],
				parse: toPath,
				nonZeroExit: "error" as const,
			}));
		default:
			return [];
	}
}

/**
 * Resolve the `THINKRAIL_PICK_DIR` dev/e2e override. When it names an existing **file**, the returned
 * path is that file's trimmed contents — read **live per call**, so a test can rewrite the pointer to
 * switch which folder the picker returns without restarting the host (e.g. a git repo for one test, a
 * plain non-git folder for another). Otherwise the value is returned as-is (a directory path). Empty →
 * no override (fall through to the native picker).
 */
function resolveOverride(): string | null {
	const value = process.env.THINKRAIL_PICK_DIR;
	if (!value) return null;
	try {
		if (statSync(value).isFile()) return readFileSync(value, "utf8").trim() || null;
	} catch {
		// Not a stat-able path (e.g. a directory that doesn't exist yet) — treat the value literally.
	}
	return value;
}

/**
 * Why a picker that *ran* failed, for the notice the user sees: its first stderr line, else the exit code
 * (a killed picker writes nothing). PowerShell's CRLF output would otherwise leave a trailing `\r`.
 */
export function pickerFailure(stderr: string, code: number): string {
	const firstLine = stderr.replaceAll("\r", "").trim().split("\n")[0];
	return `The folder picker failed: ${firstLine || `exit ${code}`}`;
}

/** Why we couldn't even start a picker — phrased so the user can act on it. */
export function noPickerMessage(platform: NodeJS.Platform): string {
	return platform === "linux"
		? "No folder picker on this host — install zenity or kdialog."
		: `No native folder picker is available on this host (${platform}).`;
}

/**
 * Pop the host's native folder picker and return the chosen path (`null` when the user cancelled).
 * A missing binary falls through to the next candidate; **throws** when a picker failed or none could
 * run at all — the picker is the only way to add a project, so a silent `null` is a dead button.
 */
export async function selectDirectory(): Promise<{ path: string | null }> {
	const override = resolveOverride();
	if (override) return { path: override };

	for (const picker of pickersFor(process.platform)) {
		let out: string;
		let err: string;
		let code: number;
		try {
			const proc = Bun.spawn(picker.cmd, { stdout: "pipe", stderr: "pipe" });
			[out, err, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
		} catch {
			continue; // Binary not installed (e.g. no zenity) — try the next candidate.
		}
		if (code === 0) return { path: picker.parse(out) };
		if (picker.nonZeroExit === "cancel") return { path: null };
		throw new Error(pickerFailure(err, code));
	}
	throw new Error(noPickerMessage(process.platform));
}
