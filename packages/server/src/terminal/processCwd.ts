import { readFile, readlink } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
	isPlausiblePid,
	parseProcChildren,
	procChildrenPath,
	SYSTEM_TOOL_PATH,
	SYSTEM_TOOL_TIMEOUT_MS,
	systemTool,
} from "./shellBusy";

export type ChildLookup = (
	pid: number,
) => Promise<readonly number[] | null> | readonly number[] | null;

export interface ProcessTable {
	children: ChildLookup;
	cwds(pids: readonly number[]): Promise<ReadonlyMap<number, string>>;
}

export interface ToolRun {
	stdout: string;
	exitCode: number | null;
	timedOut: boolean;
}

export type RunTool = (argv: readonly string[]) => Promise<ToolRun | null>;

const MAX_DESCENT = 16;

export function parseLsofCwds(output: string): Map<number, string> {
	const cwds = new Map<number, string>();
	let pid: number | null = null;
	for (const line of output.split("\n")) {
		if (line.startsWith("p")) {
			const parsed = Number(line.slice(1));
			pid = isPlausiblePid(parsed) ? parsed : null;
		} else if (line.startsWith("n") && pid !== null) {
			const name = line.slice(1);
			if (isAbsolute(name)) cwds.set(pid, name);
		}
	}
	return cwds;
}

export function parseProcessTable(output: string): Map<number, number[]> {
	const children = new Map<number, number[]>();
	for (const line of output.split("\n")) {
		const [pid, ppid] = parseProcChildren(line);
		if (pid === undefined || ppid === undefined) continue;
		const siblings = children.get(ppid);
		if (siblings) siblings.push(pid);
		else children.set(ppid, [pid]);
	}
	return children;
}

export async function foregroundPid(shellPid: number, children: ChildLookup): Promise<number> {
	let pid = shellPid;
	const visited = new Set([pid]);
	for (let depth = 0; depth < MAX_DESCENT; depth += 1) {
		const next = ((await children(pid)) ?? []).filter(
			(child) => isPlausiblePid(child) && !visited.has(child),
		);
		if (next.length === 0) break;
		pid = Math.max(...next);
		visited.add(pid);
	}
	return pid;
}

export async function processWorkingDirectories(
	shellPid: number,
	table: ProcessTable,
): Promise<string[]> {
	if (!isPlausiblePid(shellPid)) return [];
	const foreground = await foregroundPid(shellPid, table.children);
	const pids = foreground === shellPid ? [shellPid] : [foreground, shellPid];
	const cwds = await table.cwds(pids);
	return [...new Set(pids.flatMap((pid) => cwds.get(pid) ?? []))];
}

interface CacheEntry {
	settledAt: number | null;
	cwds: Promise<string[]>;
}

export function createWorkingDirectoryCache(options: {
	ttlMs: number;
	now?: () => number;
	lookup: (pid: number) => Promise<string[]>;
}): (pid: number) => Promise<string[]> {
	const now = options.now ?? Date.now;
	const entries = new Map<number, CacheEntry>();
	return (pid) => {
		const at = now();
		for (const [key, entry] of entries) {
			if (entry.settledAt !== null && at - entry.settledAt >= options.ttlMs) entries.delete(key);
		}
		const cached = entries.get(pid);
		if (cached) return cached.cwds;
		const entry: CacheEntry = { settledAt: null, cwds: Promise.resolve([]) };
		entry.cwds = Promise.resolve()
			.then(() => options.lookup(pid))
			.catch((): string[] => [])
			.then((cwds) => {
				entry.settledAt = now();
				return cwds;
			});
		entries.set(pid, entry);
		return entry.cwds;
	};
}

function spawnPiped(argv: string[]) {
	try {
		return Bun.spawn(argv, {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			env: { PATH: SYSTEM_TOOL_PATH },
			windowsHide: true,
		});
	} catch {
		return null;
	}
}

export async function runSystemTool(
	argv: readonly string[],
	timeoutMs = SYSTEM_TOOL_TIMEOUT_MS,
): Promise<ToolRun | null> {
	const [name, ...args] = argv;
	const executable = name === undefined ? null : systemTool(name);
	const child = executable ? spawnPiped([executable, ...args]) : null;
	if (!child) return null;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, timeoutMs);
	try {
		const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		return { stdout, exitCode, timedOut };
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

async function procChildren(pid: number): Promise<number[] | null> {
	try {
		return parseProcChildren(await readFile(procChildrenPath(pid), "utf8"));
	} catch {
		return null;
	}
}

async function procCwds(pids: readonly number[]): Promise<Map<number, string>> {
	const found = await Promise.all(
		pids.map(async (pid) => {
			try {
				return [pid, await readlink(`/proc/${pid}/cwd`)] as const;
			} catch {
				return null;
			}
		}),
	);
	return new Map(found.filter((entry) => entry !== null));
}

function usableRun(run: ToolRun | null): run is ToolRun {
	return run !== null && !run.timedOut;
}

export function systemProcessTable(
	platform: NodeJS.Platform = process.platform,
	run: RunTool = runSystemTool,
): ProcessTable {
	if (platform === "win32") return { children: () => null, cwds: async () => new Map() };
	let snapshot: Promise<Map<number, number[]> | null> | undefined;
	const snapshotChildren = async (pid: number): Promise<number[] | null> => {
		snapshot ??= run(["ps", "-A", "-o", "pid=,ppid="]).then((result) =>
			usableRun(result) && result.exitCode === 0 ? parseProcessTable(result.stdout) : null,
		);
		const table = await snapshot;
		return table ? (table.get(pid) ?? []) : null;
	};
	return {
		children: async (pid) =>
			(platform === "linux" ? await procChildren(pid) : null) ?? snapshotChildren(pid),
		cwds: async (pids) => {
			const wanted = pids.filter(isPlausiblePid);
			if (wanted.length === 0) return new Map();
			if (platform === "linux") return procCwds(wanted);
			const result = await run([
				"lsof",
				"-b",
				"-w",
				"-a",
				"-d",
				"cwd",
				"-Fpn",
				"-p",
				wanted.join(","),
			]);
			return usableRun(result) ? parseLsofCwds(result.stdout) : new Map();
		},
	};
}
