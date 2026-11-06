import { readFileSync } from "node:fs";
import { spawnSyncCaptured } from "@thinkrail/shared/spawn";

export function parseProcChildren(contents: string): number[] {
	return contents
		.split(/\s+/)
		.map((entry) => Number.parseInt(entry, 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

function isPlausiblePid(pid: number): boolean {
	return Number.isInteger(pid) && pid > 0;
}

function childrenViaProc(pid: number): number[] | null {
	try {
		return parseProcChildren(readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8"));
	} catch {
		return null;
	}
}

function childrenViaPgrep(pid: number): number[] | null {
	const run = spawnSyncCaptured(["pgrep", "-P", String(pid)]);
	if (!run.launched) return null;
	if (run.exitCode === 0) return parseProcChildren(run.stdout);
	if (run.exitCode === 1) return [];
	return null;
}

export const WINDOWS_CHILD_COUNT = [
	"$ErrorActionPreference = 'Stop'",
	'$kids = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$env:TR_PARENT_PID")',
	"Write-Output $kids.Count",
].join("; ");

function childrenViaCim(pid: number): boolean | null {
	for (const shell of ["powershell.exe", "pwsh.exe"]) {
		const run = spawnSyncCaptured([shell, "-NoProfile", "-Command", WINDOWS_CHILD_COUNT], {
			env: { ...process.env, TR_PARENT_PID: String(pid) },
		});
		if (!run.launched || run.exitCode !== 0) continue;
		const count = Number.parseInt(run.stdout.trim(), 10);
		if (Number.isInteger(count)) return count > 0;
	}
	return null;
}

export function childProcesses(pid: number): number[] | null {
	if (!isPlausiblePid(pid) || process.platform === "win32") return null;
	return childrenViaProc(pid) ?? childrenViaPgrep(pid);
}

export function hasChildProcesses(pid: number): boolean {
	if (!isPlausiblePid(pid)) return false;
	if (process.platform === "win32") return childrenViaCim(pid) ?? false;
	return (childProcesses(pid)?.length ?? 0) > 0;
}
