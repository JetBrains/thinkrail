/**
 * Does this shell have anything running in it?
 *
 * Asked at exactly one moment: the user clicked × on a terminal tab. Closing a tab is now the only client-driven
 * way to kill a shell, and shells outlive reloads and browsers — so an unguarded × can silently take down a dev
 * server that has been running for hours. VS Code guards the same gesture the same way (`confirmOnKill`).
 *
 * The shell itself is the PTY's process; anything it spawned is a child of it. So "busy" is "the shell has
 * children" — which is why an idle prompt closes in one click and a running `npm run dev` asks first.
 */

import { readFileSync } from "node:fs";

/** `/proc/<pid>/task/<pid>/children` — whitespace-separated pids, empty when the process has none. */
export function parseProcChildren(contents: string): number[] {
	return contents
		.split(/\s+/)
		.map((entry) => Number.parseInt(entry, 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** Linux's cheap path: one small synchronous read, no process spawn. Null when the kernel doesn't expose it. */
function childrenViaProc(pid: number): boolean | null {
	try {
		return parseProcChildren(readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")).length > 0;
	} catch {
		// Not Linux, CONFIG_PROC_CHILDREN off, or the process is already gone — the caller falls back.
		return null;
	}
}

/** POSIX fallback (macOS has no `/proc`): `pgrep -P` exits 0 only when the pid has at least one child. */
function childrenViaPgrep(pid: number): boolean | null {
	try {
		const run = Bun.spawnSync(["pgrep", "-P", String(pid)], { stdout: "pipe", stderr: "ignore" });
		// 0 = matched, 1 = no match, anything else (missing binary, error) is not an answer.
		if (run.exitCode === 0) return true;
		if (run.exitCode === 1) return false;
		return null;
	} catch {
		return null;
	}
}

/**
 * Windows: count processes whose parent is `pid` via CIM.
 *
 * Printed as a count rather than signalled by exit code — PowerShell exits 0 whether or not the query
 * matched, so "no children" and "the query failed" would otherwise be indistinguishable and we would guess
 * *not busy* on a host where the check actually works. `$ErrorActionPreference = 'Stop'` turns a blocked
 * cmdlet (ConstrainedLanguage mode) into a non-zero exit instead of silent empty output.
 */
export const WINDOWS_CHILD_COUNT = [
	"$ErrorActionPreference = 'Stop'",
	'$kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$env:TR_PARENT_PID")',
	"Write-Output $kids.Count",
].join("; ");

function childrenViaCim(pid: number): boolean | null {
	// The same two hosts (and order) the directory picker and `apps/cli/src/powershell.ts` use.
	for (const shell of ["powershell.exe", "pwsh.exe"]) {
		try {
			// The pid rides an env var, never the command string: interpolating into PowerShell's own parser is
			// the injection minefield `apps/cli/src/powershell.ts` exists to sidestep.
			const run = Bun.spawnSync([shell, "-NoProfile", "-Command", WINDOWS_CHILD_COUNT], {
				stdout: "pipe",
				stderr: "ignore",
				env: { ...process.env, TR_PARENT_PID: String(pid) },
			});
			if (run.exitCode !== 0) continue;
			const count = Number.parseInt(run.stdout.toString().trim(), 10);
			if (Number.isInteger(count)) return count > 0;
		} catch {
			// Host missing or not spawnable — try the next one.
		}
	}
	return null;
}

/**
 * Whether `pid` has at least one child process.
 *
 * Probes in cost order — a `/proc` read, then `pgrep`, then CIM on Windows — and returns **false when none of
 * them can answer**. That is the deliberate direction to fail: an unanswerable check must not make every tab
 * close a confirmation prompt, which would train people to click through the one that mattered.
 */
export function hasChildProcesses(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	if (process.platform === "win32") return childrenViaCim(pid) ?? false;
	return childrenViaProc(pid) ?? childrenViaPgrep(pid) ?? false;
}
