import { rmSync } from "node:fs";

/**
 * Move a file to the OS trash so a delete stays recoverable — mirrors pi's own session delete: try the
 * `trash` CLI first, fall back to a permanent unlink when it isn't installed (or fails). Best-effort;
 * a missing file is a no-op (`force`).
 */
export function trashFile(path: string): void {
	try {
		if (Bun.spawnSync(["trash", path], { stdout: "ignore", stderr: "ignore" }).success) return;
	} catch {
		// `trash` isn't installed / can't be spawned — fall through to a permanent delete.
	}
	rmSync(path, { force: true });
}
