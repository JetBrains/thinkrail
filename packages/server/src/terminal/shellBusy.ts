import { readFileSync } from "node:fs";
import { spawnSyncCaptured } from "@thinkrail/shared/spawn";

export function parseProcChildren(contents: string): number[] {
	return contents
		.split(/\s+/)
		.map((entry) => Number.parseInt(entry, 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

function childrenViaProc(pid: number): boolean | null {
	try {
		return parseProcChildren(readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")).length > 0;
	} catch {
		return null;
	}
}

function childrenViaPgrep(pid: number): boolean | null {
	const run = spawnSyncCaptured(["pgrep", "-P", String(pid)]);
	if (!run.launched) return null;
	if (run.exitCode === 0) return true;
	if (run.exitCode === 1) return false;
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

export function hasChildProcesses(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	if (process.platform === "win32") return childrenViaCim(pid) ?? false;
	return childrenViaProc(pid) ?? childrenViaPgrep(pid) ?? false;
}
