import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOSTS = ["powershell.exe", "pwsh.exe"];

const FLAGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

const BOM = "\uFEFF";

const KILL_GRACE_MS = 2_000;
const DRAIN_GRACE_MS = 3_000;

function killWindowsTree(pid: number | undefined): void {
	if (pid === undefined || process.platform !== "win32") return;
	try {
		Bun.spawn(["taskkill", "/T", "/F", "/PID", String(pid)], {
			stdout: "ignore",
			stderr: "ignore",
		}).unref();
	} catch {}
}

export function psQuote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

export interface PowerShellResult {
	exitCode: number;
	stdout: string;
	timedOut: boolean;
}

export interface RunPowerShellOptions {
	env?: Record<string, string | undefined>;
	capture?: boolean;
	timeoutMs?: number;
}

async function readStream(stream: unknown): Promise<string> {
	if (!(stream instanceof ReadableStream)) return "";
	try {
		return await new Response(stream).text();
	} catch {
		return "";
	}
}

export async function runPowerShellScript(
	script: string,
	args: readonly string[] = [],
	options: RunPowerShellOptions = {},
): Promise<PowerShellResult | undefined> {
	const path = join(tmpdir(), `thinkrail-${randomUUID()}.ps1`);
	await Bun.write(path, script.startsWith(BOM) ? script : `${BOM}${script}`);
	try {
		for (const host of HOSTS) {
			let run: ReturnType<typeof Bun.spawn>;
			try {
				run = Bun.spawn([host, ...FLAGS, "-File", path, ...args], {
					stdout: options.capture ? "pipe" : "inherit",
					stderr: "inherit",
					...(options.env ? { env: options.env } : {}),
				});
			} catch {
				continue;
			}
			const drained = readStream(run.stdout);
			if (options.timeoutMs === undefined) {
				const exitCode = await run.exited;
				return { exitCode, stdout: await drained, timedOut: false };
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const expiry = new Promise<"timeout">((resolve) => {
				timer = setTimeout(() => resolve("timeout"), options.timeoutMs);
				timer.unref?.();
			});
			try {
				const finished = await Promise.race([run.exited, expiry]);
				if (finished !== "timeout") {
					return { exitCode: finished, stdout: await drained, timedOut: false };
				}
				killWindowsTree(run.pid);
				run.kill();
				const forced = setTimeout(() => run.kill(9), KILL_GRACE_MS);
				forced.unref?.();
				// Never wait on EOF here: a descendant of the installer can hold the inherited pipe open
				// past its parent's death, and the caller's operation slot must be released regardless.
				const exitCode = await Promise.race([
					run.exited,
					Bun.sleep(DRAIN_GRACE_MS).then(() => 124),
				]);
				clearTimeout(forced);
				const stdout = await Promise.race([drained, Bun.sleep(DRAIN_GRACE_MS).then(() => "")]);
				return { exitCode, stdout, timedOut: true };
			} finally {
				if (timer) clearTimeout(timer);
			}
		}
		return undefined;
	} finally {
		rmSync(path, { force: true });
	}
}

export function spawnDetachedPowerShell(command: string): boolean {
	for (const host of HOSTS) {
		try {
			Bun.spawn([host, ...FLAGS, "-WindowStyle", "Hidden", "-Command", command], {
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
			}).unref();
			return true;
		} catch {}
	}
	return false;
}
