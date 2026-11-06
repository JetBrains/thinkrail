import { readlinkSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawnSyncCaptured } from "@thinkrail/shared/spawn";
import { childProcesses } from "./shellBusy";

export interface ProcessTable {
	children(pid: number): readonly number[] | null;
	cwd(pid: number): string | null;
}

const MAX_DESCENT = 16;
const LSOF_TIMEOUT_MS = 1_000;
const LSOF_SEARCH_PATH = "/usr/sbin:/usr/bin:/sbin:/bin";

export function parseLsofCwd(output: string): string | null {
	for (const line of output.split("\n")) {
		if (!line.startsWith("n")) continue;
		const name = line.slice(1);
		return name !== "" && isAbsolute(name) ? name : null;
	}
	return null;
}

function isPlausiblePid(pid: number): boolean {
	return Number.isInteger(pid) && pid > 0;
}

export function foregroundPid(shellPid: number, table: Pick<ProcessTable, "children">): number {
	let pid = shellPid;
	for (let depth = 0; depth < MAX_DESCENT; depth += 1) {
		const children = table.children(pid)?.filter(isPlausiblePid) ?? [];
		if (children.length === 0) break;
		pid = Math.max(...children);
	}
	return pid;
}

export function processWorkingDirectories(shellPid: number, table: ProcessTable): string[] {
	if (!isPlausiblePid(shellPid)) return [];
	const foreground = foregroundPid(shellPid, table);
	const found = [foreground === shellPid ? null : table.cwd(foreground), table.cwd(shellPid)];
	return [...new Set(found.filter((cwd): cwd is string => cwd !== null))];
}

export function createWorkingDirectoryCache(options: {
	ttlMs: number;
	now?: () => number;
	lookup: (pid: number) => string[];
}): (pid: number) => string[] {
	const now = options.now ?? Date.now;
	const entries = new Map<number, { at: number; cwds: string[] }>();
	return (pid) => {
		const at = now();
		for (const [key, entry] of entries) {
			if (at - entry.at >= options.ttlMs) entries.delete(key);
		}
		const cached = entries.get(pid);
		if (cached) return cached.cwds;
		const cwds = options.lookup(pid);
		entries.set(pid, { at, cwds });
		return cwds;
	};
}

function procCwd(pid: number): string | null {
	try {
		return readlinkSync(`/proc/${pid}/cwd`);
	} catch {
		return null;
	}
}

let lsofPath: string | null | undefined;

function lsofCwd(pid: number): string | null {
	lsofPath ??= Bun.which("lsof", { PATH: LSOF_SEARCH_PATH });
	if (!lsofPath) return null;
	const run = spawnSyncCaptured(
		[lsofPath, "-b", "-w", "-a", "-p", String(pid), "-d", "cwd", "-Fn"],
		{
			timeoutMs: LSOF_TIMEOUT_MS,
		},
	);
	return run.launched && run.exitCode === 0 ? parseLsofCwd(run.stdout) : null;
}

export function systemProcessTable(platform: NodeJS.Platform = process.platform): ProcessTable {
	if (platform === "win32") return { children: () => null, cwd: () => null };
	return {
		children: childProcesses,
		cwd: (pid) => (isPlausiblePid(pid) ? (procCwd(pid) ?? lsofCwd(pid)) : null),
	};
}
