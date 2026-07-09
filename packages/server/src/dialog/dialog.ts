// Native directory picker, run on the host (the machine the repos live on). One picker per OS
// (macOS `osascript`, Linux `zenity`/`kdialog`, Windows PowerShell); `THINKRAIL_PICK_DIR`
// overrides it so the flow is drivable headlessly in dev/e2e.

import { readFileSync, statSync } from "node:fs";

/** A candidate native picker: the command to spawn + how to read a chosen path from its stdout. */
export interface Picker {
	cmd: string[];
	/** Map raw stdout to an absolute path, or `null` when nothing usable was returned. */
	parse: (stdout: string) => string | null;
}

// Trim surrounding whitespace and any trailing path separator(s); empty → null. Shared across
// platforms — macOS returns a trailing-slash POSIX path, Windows backslashes, zenity/kdialog neither.
const toPath = (stdout: string): string | null => stdout.trim().replace(/[/\\]+$/, "") || null;

// PowerShell folder picker: a WinForms FolderBrowserDialog; prints the path on OK, nothing on cancel.
const WINDOWS_PICKER =
	"Add-Type -AssemblyName System.Windows.Forms; " +
	"$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
	"$d.Description = 'Open project'; " +
	"if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }";

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
				},
			];
		case "linux":
			return [
				{
					cmd: ["zenity", "--file-selection", "--directory", "--title=Open project"],
					parse: toPath,
				},
				{
					cmd: ["kdialog", "--getexistingdirectory", ".", "--title", "Open project"],
					parse: toPath,
				},
			];
		case "win32":
			return [{ cmd: ["powershell", "-NoProfile", "-Command", WINDOWS_PICKER], parse: toPath }];
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
 * Pop the host's native folder picker and return the chosen path (`null` on cancel / no picker).
 * A missing binary falls through to the next candidate; a non-zero exit is a user cancel (stop).
 */
export async function selectDirectory(): Promise<{ path: string | null }> {
	const override = resolveOverride();
	if (override) return { path: override };

	for (const picker of pickersFor(process.platform)) {
		try {
			const proc = Bun.spawn(picker.cmd, { stdout: "pipe", stderr: "ignore" });
			const out = await new Response(proc.stdout).text();
			const code = await proc.exited;
			if (code !== 0) return { path: null }; // user cancelled the dialog
			return { path: picker.parse(out) };
		} catch {
			// Binary not installed (e.g. no zenity) — try the next candidate.
		}
	}
	return { path: null };
}
