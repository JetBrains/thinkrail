// The Windows PowerShell seam: find a host, run a script *text* through it, quote a value into it.
// Shared by `update` (runs the fetched `install.ps1`) and `uninstall` (edits the PATH registry value +
// deletes the exe that is still running). Nothing here is Windows-*only* mechanically — the callers gate
// on `process.platform` — but nothing here makes sense elsewhere either.

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Hosts to try, in order: `powershell.exe` (Windows PowerShell 5.1) ships with every Windows, so it is
 * the default; `pwsh.exe` (PowerShell 7+) covers a box where the inbox one was stripped or removed.
 */
const HOSTS = ["powershell.exe", "pwsh.exe"];

/** Flags every invocation wants: no user profile, no prompts, and a policy that lets our temp file run. */
const FLAGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

/** UTF-8 byte-order mark — what tells Windows PowerShell 5.1 a script file isn't ANSI. */
const BOM = "\uFEFF";

/** Escape `value` for a PowerShell single-quoted literal (`'` doubles; everything else is literal). */
export function psQuote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export interface PowerShellResult {
	exitCode: number;
	/** The script's stdout — empty unless `capture` was set. */
	stdout: string;
}

export interface RunPowerShellOptions {
	/** Env for the child (defaults to ours). */
	env?: Record<string, string | undefined>;
	/** Capture stdout instead of letting the script write to ours. */
	capture?: boolean;
}

/**
 * Run `script` (PowerShell source) with `args` appended after `-File`, so the script's own `param()`
 * block receives them through argv — no shell, no quoting. Returns the result, or `undefined` when no
 * PowerShell host could be launched at all (the caller decides what to tell the user).
 *
 * The script goes to a temp file rather than `-Command`: `-Command` quoting is a minefield and cannot
 * carry named params. A UTF-8 BOM is prepended when absent because Windows PowerShell 5.1 reads a
 * BOM-less file as ANSI, which would mangle any non-ASCII character in it.
 */
export async function runPowerShellScript(
	script: string,
	args: readonly string[] = [],
	options: RunPowerShellOptions = {},
): Promise<PowerShellResult | undefined> {
	const path = join(tmpdir(), `thinkrail-${randomUUID()}.ps1`);
	await Bun.write(path, script.startsWith(BOM) ? script : `${BOM}${script}`);
	try {
		for (const host of HOSTS) {
			let run: ReturnType<typeof Bun.spawnSync>;
			try {
				run = Bun.spawnSync([host, ...FLAGS, "-File", path, ...args], {
					stdout: options.capture ? "pipe" : "inherit",
					stderr: "inherit",
					...(options.env ? { env: options.env } : {}),
				});
			} catch {
				// Not on PATH (or not executable) — try the next host.
				continue;
			}
			return { exitCode: run.exitCode ?? 1, stdout: run.stdout?.toString() ?? "" };
		}
		return undefined;
	} finally {
		rmSync(path, { force: true });
	}
}

/**
 * Start `command` (a one-liner) in a PowerShell that outlives us, best-effort — the only way to finish a
 * job that can't complete while this process is alive (deleting our own exe). Returns whether a host
 * could be started at all; the command's own outcome is unobservable by design.
 */
export function spawnDetachedPowerShell(command: string): boolean {
	for (const host of HOSTS) {
		try {
			Bun.spawn([host, ...FLAGS, "-WindowStyle", "Hidden", "-Command", command], {
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
			}).unref();
			return true;
		} catch {
			// Not on PATH — try the next host.
		}
	}
	return false;
}
