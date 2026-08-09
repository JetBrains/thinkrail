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
 * Whether `pid` has at least one child process.
 *
 * Returns **false when it cannot tell** — notably on Windows, where neither probe applies. That is the
 * deliberate direction to fail: an unanswerable check must not make every tab close a confirmation prompt, which
 * would train people to click through the one that mattered. The cost is that on such a platform the guard is
 * simply absent, exactly as it is today.
 */
export function hasChildProcesses(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	return childrenViaProc(pid) ?? childrenViaPgrep(pid) ?? false;
}
