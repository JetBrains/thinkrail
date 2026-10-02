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

export interface SpawnSyncCapturedBytes {
	launched: boolean;
	exitCode: number | null;
	stdout: Uint8Array;
	stderr: string;
}

export type SpawnSyncOptions = SpawnEnvironment & { timeoutMs?: number; maxBuffer?: number };

interface SpawnSyncRaw {
	launched: boolean;
	exitCode: number | null;
	stdout: Uint8Array;
	stderr: Uint8Array;
}

const NO_OUTPUT = new Uint8Array(0);

function spawnSyncRaw(argv: readonly string[], options: SpawnSyncOptions): SpawnSyncRaw {
	if (argv.length === 0)
		return { launched: false, exitCode: null, stdout: NO_OUTPUT, stderr: NO_OUTPUT };
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
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch {
		return { launched: false, exitCode: null, stdout: NO_OUTPUT, stderr: NO_OUTPUT };
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
