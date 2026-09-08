import { spawn, spawnSync } from "node:child_process";

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
	const [command, ...args] = argv;
	if (!command) return { launched: false, exitCode: null, stdout: "", stderr: "" };
	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: options.env as NodeJS.ProcessEnv | undefined,
		windowsHide: true,
		encoding: "buffer",
		...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
		...(options.maxBuffer !== undefined ? { maxBuffer: options.maxBuffer } : {}),
	});
	if (result.error) return { launched: false, exitCode: null, stdout: "", stderr: "" };
	return {
		launched: true,
		exitCode: result.status,
		stdout: (result.stdout ?? Buffer.alloc(0)).toString("utf8"),
		stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
	};
}

export function spawnDetached(
	argv: readonly string[],
	options: SpawnEnvironment = {},
): Promise<boolean> {
	const [command, ...args] = argv;
	if (!command) return Promise.resolve(false);
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				cwd: options.cwd,
				env: options.env as NodeJS.ProcessEnv | undefined,
				stdio: "ignore",
				windowsHide: true,
				detached: process.platform !== "win32",
			});
		} catch {
			resolve(false);
			return;
		}
		child.once("error", () => resolve(false));
		child.once("spawn", () => resolve(true));
		child.unref();
	});
}
