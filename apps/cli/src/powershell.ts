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
}

export interface RunPowerShellOptions {
	env?: Record<string, string | undefined>;
	capture?: boolean;
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
			let run: ReturnType<typeof Bun.spawnSync>;
			try {
				run = Bun.spawnSync([host, ...FLAGS, "-File", path, ...args], {
					stdout: options.capture ? "pipe" : "inherit",
					stderr: "inherit",
					...(options.env ? { env: options.env } : {}),
				});
			} catch {
				continue;
			}
			return { exitCode: run.exitCode ?? 1, stdout: run.stdout?.toString() ?? "" };
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
