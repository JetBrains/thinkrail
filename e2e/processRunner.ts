import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";

export const E2E_ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
export const PARENT_SIGNAL_OWNER_ENV = "THINKRAIL_E2E_PARENT_SIGNAL_OWNER";
export const PROCESS_TERMINATION_GRACE_MS = 2_000;

export interface ProcessRunResult {
	exitCode: number;
	stdout: string;
}

export interface ProcessRunOptions {
	env?: NodeJS.ProcessEnv;
	stdout?: "inherit" | "pipe";
	terminationGraceMs?: number;
}

interface PosixProcessSnapshot {
	pid: number;
	ppid: number;
	pgid: number;
}

interface WindowsProcessSnapshot {
	pid: number;
	ppid: number;
}

interface ActiveProcess {
	child: ChildProcess;
	pid: number;
	terminationGraceMs: number;
	interruptedBy: NodeJS.Signals | null;
	forceTimer: ReturnType<typeof setTimeout> | null;
	trackedPosixPids: Map<number, number | null>;
	trackedPosixProcessGroups: Set<number>;
	retainedWindowsPids: Set<number>;
}

const activeProcesses = new Set<ActiveProcess>();
let interruptedBy: NodeJS.Signals | null = null;
let listening = false;

export function signalExitCode(signal: NodeJS.Signals): number {
	return 128 + (constants.signals[signal] ?? 1);
}

export function processRunnerInterruption(): NodeJS.Signals | null {
	return interruptedBy;
}

function readPosixProcessSnapshot(): PosixProcessSnapshot[] {
	const result = spawnSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8" });
	if (result.error || result.status !== 0 || typeof result.stdout !== "string") return [];
	const snapshot: PosixProcessSnapshot[] = [];
	for (const line of result.stdout.split("\n")) {
		const [pidText, ppidText, pgidText] = line.trim().split(/\s+/);
		const pid = Number(pidText);
		const ppid = Number(ppidText);
		const pgid = Number(pgidText);
		if (
			Number.isInteger(pid) &&
			pid > 0 &&
			Number.isInteger(ppid) &&
			ppid >= 0 &&
			Number.isInteger(pgid) &&
			pgid > 0
		) {
			snapshot.push({ pid, ppid, pgid });
		}
	}
	return snapshot;
}

function readWindowsProcessSnapshot(): WindowsProcessSnapshot[] {
	try {
		const result = spawnSync(
			"powershell.exe",
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.ParentProcessId }",
			],
			{ encoding: "utf8", windowsHide: true },
		);
		if (result.error || result.status !== 0 || typeof result.stdout !== "string") return [];
		const snapshot: WindowsProcessSnapshot[] = [];
		for (const line of result.stdout.split("\n")) {
			const [pidText, ppidText] = line.trim().split(/\s+/);
			const pid = Number(pidText);
			const ppid = Number(ppidText);
			if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && ppid >= 0) {
				snapshot.push({ pid, ppid });
			}
		}
		return snapshot;
	} catch {
		return [];
	}
}

function trackActivePosixTrees(actives: readonly ActiveProcess[]): void {
	const snapshot = readPosixProcessSnapshot();
	const byPid = new Map(snapshot.map((entry) => [entry.pid, entry]));
	const byParent = new Map<number, PosixProcessSnapshot[]>();
	for (const entry of snapshot) {
		const children = byParent.get(entry.ppid) ?? [];
		children.push(entry);
		byParent.set(entry.ppid, children);
	}
	const ownProcessGroup = byPid.get(process.pid)?.pgid;
	for (const active of actives) {
		const pending = [active.pid];
		while (pending.length > 0) {
			const pid = pending.pop();
			if (pid === undefined || active.trackedPosixPids.has(pid)) continue;
			const entry = byPid.get(pid);
			const safeProcessGroup =
				entry && entry.pgid !== ownProcessGroup
					? entry.pgid
					: !entry && pid === active.pid
						? active.pid
						: null;
			active.trackedPosixPids.set(pid, safeProcessGroup);
			if (safeProcessGroup !== null) {
				active.trackedPosixProcessGroups.add(safeProcessGroup);
			}
			for (const child of byParent.get(pid) ?? []) pending.push(child.pid);
		}
	}
}

function trackActiveWindowsTrees(actives: readonly ActiveProcess[]): void {
	const byParent = new Map<number, WindowsProcessSnapshot[]>();
	for (const entry of readWindowsProcessSnapshot()) {
		const children = byParent.get(entry.ppid) ?? [];
		children.push(entry);
		byParent.set(entry.ppid, children);
	}
	for (const active of actives) {
		const pending = [active.pid];
		while (pending.length > 0) {
			const pid = pending.pop();
			if (pid === undefined || active.retainedWindowsPids.has(pid)) continue;
			active.retainedWindowsPids.add(pid);
			for (const child of byParent.get(pid) ?? []) pending.push(child.pid);
		}
	}
}

function signalTrackedPosixProcessTree(active: ActiveProcess, signal: NodeJS.Signals): void {
	for (const processGroup of active.trackedPosixProcessGroups) {
		try {
			process.kill(-processGroup, signal);
		} catch {}
	}
	for (const [pid, safeProcessGroup] of active.trackedPosixPids) {
		if (safeProcessGroup !== null || pid === process.pid) continue;
		try {
			process.kill(pid, signal);
		} catch {}
	}
}

function taskkill(pid: number, force: boolean): boolean {
	try {
		const result = spawnSync(
			"taskkill.exe",
			["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
			{ stdio: "ignore", windowsHide: true },
		);
		return !result.error && result.status === 0;
	} catch {
		return false;
	}
}

function signalProcessTree(active: ActiveProcess, signal: NodeJS.Signals, force: boolean): void {
	if (process.platform === "win32") {
		if (!force) {
			if (!taskkill(active.pid, false)) active.child.kill(signal);
			return;
		}
		let rootKilled = false;
		for (const pid of active.retainedWindowsPids) {
			const killed = taskkill(pid, true);
			if (pid === active.pid) rootKilled = killed;
		}
		if (!rootKilled) active.child.kill("SIGKILL");
		return;
	}
	signalTrackedPosixProcessTree(active, force ? "SIGKILL" : signal);
}

function stopListeningWhenIdle(): void {
	if (!listening || activeProcesses.size > 0) return;
	process.off("SIGINT", onSigint);
	process.off("SIGTERM", onSigterm);
	listening = false;
}

function finishActiveProcess(active: ActiveProcess): void {
	if (active.forceTimer) clearTimeout(active.forceTimer);
	active.forceTimer = null;
	activeProcesses.delete(active);
	stopListeningWhenIdle();
}

function forceActiveProcess(active: ActiveProcess): void {
	if (!activeProcesses.has(active)) return;
	signalProcessTree(active, "SIGKILL", true);
	finishActiveProcess(active);
}

function interrupt(signal: NodeJS.Signals): void {
	if (interruptedBy) {
		for (const active of [...activeProcesses]) forceActiveProcess(active);
		return;
	}
	interruptedBy = signal;
	const actives = [...activeProcesses];
	if (process.platform === "win32") trackActiveWindowsTrees(actives);
	else trackActivePosixTrees(actives);
	for (const active of actives) {
		active.interruptedBy = signal;
		signalProcessTree(active, signal, false);
		active.forceTimer = setTimeout(() => forceActiveProcess(active), active.terminationGraceMs);
	}
}

function onSigint(): void {
	interrupt("SIGINT");
}

function onSigterm(): void {
	interrupt("SIGTERM");
}

function listenForSignals(): void {
	if (listening || process.env[PARENT_SIGNAL_OWNER_ENV] === "1") return;
	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);
	listening = true;
}

export async function runE2eProcess(
	command: readonly string[],
	options: ProcessRunOptions = {},
): Promise<ProcessRunResult> {
	if (interruptedBy) return { exitCode: signalExitCode(interruptedBy), stdout: "" };
	const executable = command[0];
	if (!executable) throw new Error("Cannot run an empty E2E command");
	const child = spawn(executable, command.slice(1), {
		cwd: E2E_ROOT_DIR,
		detached: true,
		env: options.env ?? process.env,
		stdio: ["ignore", options.stdout ?? "inherit", "inherit"],
		windowsHide: true,
	});
	if (!child.pid) throw new Error(`Could not start ${JSON.stringify(executable)}`);
	const active: ActiveProcess = {
		child,
		pid: child.pid,
		terminationGraceMs: options.terminationGraceMs ?? PROCESS_TERMINATION_GRACE_MS,
		interruptedBy: null,
		forceTimer: null,
		trackedPosixPids: new Map(),
		trackedPosixProcessGroups: new Set(),
		retainedWindowsPids: new Set(),
	};
	activeProcesses.add(active);
	listenForSignals();

	let output = "";
	if (child.stdout) {
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			output += chunk;
		});
	}

	return new Promise<ProcessRunResult>((resolve, reject) => {
		let spawnError: Error | null = null;
		child.once("error", (error) => {
			spawnError = error;
		});
		child.once("close", (code, signal) => {
			if (!active.interruptedBy) finishActiveProcess(active);
			if (spawnError) {
				reject(spawnError);
				return;
			}
			resolve({
				exitCode: active.interruptedBy
					? signalExitCode(active.interruptedBy)
					: (code ?? (signal ? signalExitCode(signal) : 1)),
				stdout: output,
			});
		});
	});
}
