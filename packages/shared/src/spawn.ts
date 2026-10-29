import { closeSync, openSync } from "node:fs";

export interface SpawnEnvironment {
	cwd?: string;
	env?: Record<string, string | undefined>;
}

export interface SpawnSyncCaptured {
	launched: boolean;
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
}

export interface SpawnSyncCapturedBytes {
	launched: boolean;
	exitCode: number | null;
	timedOut: boolean;
	stdout: Uint8Array;
	stderr: string;
}

export type SpawnSyncOptions = SpawnEnvironment & { timeoutMs?: number; maxBuffer?: number };

interface SpawnSyncRaw {
	launched: boolean;
	exitCode: number | null;
	timedOut: boolean;
	stdout: Uint8Array;
	stderr: Uint8Array;
}

const NO_OUTPUT = new Uint8Array(0);
const NOT_LAUNCHED: SpawnSyncRaw = {
	launched: false,
	exitCode: null,
	timedOut: false,
	stdout: NO_OUTPUT,
	stderr: NO_OUTPUT,
};
const GROUP_KILL = process.platform !== "win32";
// Under a terminal: stays in the caller's group so Ctrl-C reaches it; the command gets its own group.
const GROUP_SUPERVISOR = [
	"exec 3>&2 2>/dev/null",
	'if command -v setsid >/dev/null; then setsid "$@" </dev/null 2>&3 3>&- & else set -m; "$@" </dev/null 2>&3 3>&- & fi',
	"c=$!",
	"t=",
	"trap 'kill -TERM -$c' INT",
	"trap 'kill -TERM $c; kill -CONT $c; t=1' TERM",
	"wait $c; s=$?",
	"while kill -0 $c; do wait $c; s=$?; done",
	'[ -n "$t" ] && { kill -KILL -$c; exit 143; }',
	"exit $s",
].join("\n");

let interruptForwarding: boolean | undefined;

export function setInterruptForwardingForTests(on: boolean | undefined): void {
	interruptForwarding = on;
}

function hasControllingTerminal() {
	try {
		closeSync(openSync("/dev/tty", "r"));
		return true;
	} catch {
		return false;
	}
}

function forwardsInterrupts() {
	interruptForwarding ??= hasControllingTerminal();
	return interruptForwarding;
}

function launchPlan(argv: readonly string[], options: SpawnSyncOptions) {
	if (!GROUP_KILL || options.timeoutMs === undefined)
		return { command: [...argv], detached: false };
	if (!forwardsInterrupts()) return { command: [...argv], detached: true };
	const [command = "", ...rest] = argv;
	const PATH = options.env?.PATH ?? process.env.PATH;
	const resolved = Bun.which(command, {
		...(PATH !== undefined ? { PATH } : {}),
		...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
	});
	if (!resolved) return null;
	return {
		command: ["/bin/sh", "-c", GROUP_SUPERVISOR, "sh", resolved, ...rest],
		detached: false,
	};
}

function killGroup(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch {}
}

function spawnSyncRaw(argv: readonly string[], options: SpawnSyncOptions): SpawnSyncRaw {
	if (argv.length === 0) return NOT_LAUNCHED;
	const plan = launchPlan(argv, options);
	if (!plan) return NOT_LAUNCHED;
	try {
		const result = Bun.spawnSync(plan.command, {
			...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
			...(options.env !== undefined ? { env: options.env } : {}),
			stdout: "pipe",
			stderr: "pipe",
			windowsHide: true,
			...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
			...(plan.detached ? { detached: true } : {}),
			...(options.maxBuffer !== undefined ? { maxBuffer: options.maxBuffer } : {}),
		});
		const timedOut = result.exitedDueToTimeout === true;
		if (timedOut && plan.detached) killGroup(result.pid);
		return {
			launched: true,
			exitCode: result.exitCode,
			timedOut,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch {
		return NOT_LAUNCHED;
	}
}

export function spawnSyncCaptured(
	argv: readonly string[],
	options: SpawnSyncOptions = {},
): SpawnSyncCaptured {
	const result = spawnSyncRaw(argv, options);
	return {
		launched: result.launched,
		exitCode: result.exitCode,
		timedOut: result.timedOut,
		stdout: new TextDecoder().decode(result.stdout),
		stderr: new TextDecoder().decode(result.stderr),
	};
}

export function spawnSyncCapturedBytes(
	argv: readonly string[],
	options: SpawnSyncOptions = {},
): SpawnSyncCapturedBytes {
	const result = spawnSyncRaw(argv, options);
	return {
		launched: result.launched,
		exitCode: result.exitCode,
		timedOut: result.timedOut,
		stdout: result.stdout,
		stderr: new TextDecoder().decode(result.stderr),
	};
}

export function spawnDetached(argv: readonly string[], options: SpawnEnvironment = {}): boolean {
	if (argv.length === 0) return false;
	try {
		Bun.spawn([...argv], {
			...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
			...(options.env !== undefined ? { env: options.env } : {}),
			stdout: "ignore",
			stderr: "ignore",
			windowsHide: true,
			detached: process.platform !== "win32",
		}).unref();
		return true;
	} catch {
		return false;
	}
}
