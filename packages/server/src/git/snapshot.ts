import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { gitAsync, nonInteractiveGitEnv } from "./gitExec";

const SNAPSHOT_TIMEOUT_MS = 20_000;

export async function snapshotWorktree(worktreePath: string): Promise<string | null> {
	const indexOut = await gitAsync(worktreePath, ["rev-parse", "--git-path", "index"], {
		timeoutMs: SNAPSHOT_TIMEOUT_MS,
	});
	if (!indexOut.ok || !indexOut.out) return null;
	const indexPath = isAbsolute(indexOut.out) ? indexOut.out : resolve(worktreePath, indexOut.out);
	const scratch = mkdtempSync(join(tmpdir(), "thinkrail-snapshot-"));
	const scratchIndex = join(scratch, "index");
	try {
		try {
			copyFileSync(indexPath, scratchIndex);
		} catch {}
		const env = { ...nonInteractiveGitEnv(), GIT_INDEX_FILE: scratchIndex };
		const added = await gitAsync(worktreePath, ["add", "-A", "--ignore-errors", "--", "."], {
			env,
			timeoutMs: SNAPSHOT_TIMEOUT_MS,
		});
		if (!added.ok && (added.failure || /^fatal:/m.test(added.err))) return null;
		const tree = await gitAsync(worktreePath, ["write-tree"], {
			env,
			timeoutMs: SNAPSHOT_TIMEOUT_MS,
		});
		return tree.ok && tree.out ? tree.out : null;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}
