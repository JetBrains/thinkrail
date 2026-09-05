import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOSTS = ["powershell.exe", "pwsh.exe"];

const FLAGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

const BOM = "\uFEFF";

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
				run.kill();
				const forced = setTimeout(() => run.kill(9), 2_000);
				forced.unref?.();
				const exitCode = await run.exited;
				clearTimeout(forced);
				return { exitCode, stdout: await drained, timedOut: true };
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
