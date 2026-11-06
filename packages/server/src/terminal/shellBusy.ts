import { readFileSync } from "node:fs";
import { spawnSyncCaptured } from "@thinkrail/shared/spawn";

export const SYSTEM_TOOL_PATH = "/usr/bin:/bin:/usr/sbin:/sbin:/run/current-system/sw/bin";
export const SYSTEM_TOOL_TIMEOUT_MS = 1_000;

const systemTools = new Map<string, string | null>();

export function systemTool(name: string): string | null {
	let resolved = systemTools.get(name);
	if (resolved === undefined) {
		resolved = Bun.which(name, { PATH: SYSTEM_TOOL_PATH });
		systemTools.set(name, resolved);
	}
	return resolved;
}

export function parseProcChildren(contents: string): number[] {
	return contents
		.split(/\s+/)
		.map((entry) => Number.parseInt(entry, 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

export function isPlausiblePid(pid: number): boolean {
	return Number.isInteger(pid) && pid > 0;
}

export function procChildrenPath(pid: number): string {
	return `/proc/${pid}/task/${pid}/children`;
}

function childrenViaProc(pid: number): number[] | null {
	try {
		return parseProcChildren(readFileSync(procChildrenPath(pid), "utf8"));
	} catch {
		return null;
	}
}

function childrenViaPgrep(pid: number): number[] | null {
	const pgrep = systemTool("pgrep");
	if (!pgrep) return null;
	const run = spawnSyncCaptured([pgrep, "-P", String(pid)], {
		env: { PATH: SYSTEM_TOOL_PATH },
		timeoutMs: SYSTEM_TOOL_TIMEOUT_MS,
	});
	if (!run.launched || run.timedOut) return null;
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

export function hasChildProcesses(pid: number): boolean {
	if (!isPlausiblePid(pid)) return false;
	if (process.platform === "win32") return childrenViaCim(pid) ?? false;
	return (childrenViaProc(pid) ?? childrenViaPgrep(pid) ?? []).length > 0;
}
