import { rmSync } from "node:fs";

const RETRYABLE_CODES = new Set(["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]);
const WINDOWS_RETRYABLE_CODES = new Set([...RETRYABLE_CODES, "EACCES"]);
const DEFAULT_ATTEMPTS = 10;
const DEFAULT_DELAY_MS = 100;

export interface RemoveTreeOptions {
	attempts?: number;
	delayMs?: number;
	remove?: (path: string) => void;
	platform?: NodeJS.Platform;
}

function removeOnce(path: string): void {
	rmSync(path, { recursive: true, force: true });
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function codeOf(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

export function removeTree(path: string, options: RemoveTreeOptions = {}): void {
	const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
	const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
	const remove = options.remove ?? removeOnce;
	const retryable =
		(options.platform ?? process.platform) === "win32" ? WINDOWS_RETRYABLE_CODES : RETRYABLE_CODES;
	for (let attempt = 1; ; attempt++) {
		try {
			remove(path);
			return;
		} catch (error) {
			const code = codeOf(error);
			if (attempt >= attempts || !code || !retryable.has(code)) throw error;
			sleepSync(attempt * delayMs);
		}
	}
}

export function removeTreeAfter(
	path: string,
	pending: unknown,
	options: RemoveTreeOptions = {},
): void {
	try {
		removeTree(path, options);
	} catch (error) {
		if (pending === undefined) throw error;
		console.error(`could not remove ${path} while reporting a failure: ${error}`);
	}
}
