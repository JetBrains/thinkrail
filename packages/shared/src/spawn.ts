export interface SpawnEnvironment {
	cwd?: string;
	env?: Record<string, string | undefined>;
}

export interface SpawnSyncCaptured {
	launched: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export function spawnSyncCaptured(
	argv: readonly string[],
	options: SpawnEnvironment & { timeoutMs?: number; maxBuffer?: number } = {},
): SpawnSyncCaptured {
	if (argv.length === 0) return { launched: false, exitCode: null, stdout: "", stderr: "" };
	try {
		const result = Bun.spawnSync([...argv], {
			...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
			...(options.env !== undefined ? { env: options.env } : {}),
			stdout: "pipe",
			stderr: "pipe",
			windowsHide: true,
			...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
			...(options.maxBuffer !== undefined ? { maxBuffer: options.maxBuffer } : {}),
		});
		return {
			launched: true,
			exitCode: result.exitCode,
			stdout: new TextDecoder().decode(result.stdout),
			stderr: new TextDecoder().decode(result.stderr),
		};
	} catch {
		return { launched: false, exitCode: null, stdout: "", stderr: "" };
	}
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
