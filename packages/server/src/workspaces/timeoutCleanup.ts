import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { WORKSPACE_CREATE_CLEANUP_TIMEOUT_MS } from "@thinkrail/contracts";
import { canonicalPath, gitAsync } from "../git";
import { logger } from "../log";

const log = logger("workspaces");

function pathKey(path: string): string {
	let existing = resolve(path);
	const suffix: string[] = [];
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) break;
		suffix.unshift(basename(existing));
		existing = parent;
	}
	const canonical = resolve(canonicalPath(existing), ...suffix);
	return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

export async function cleanupTimedOutWorktree(
	repoPath: string,
	worktreePath: string,
): Promise<void> {
	const deadline = Date.now() + WORKSPACE_CREATE_CLEANUP_TIMEOUT_MS;
	const remaining = () => Math.max(1, deadline - Date.now());
	const run = async (args: string[]) => {
		if (Date.now() >= deadline) return null;
		return gitAsync(repoPath, args, { timeoutMs: remaining() });
	};
	const removeArgs = ["worktree", "remove", "--force", "--force", worktreePath];
	const removed = await run(removeArgs);
	if (removed?.ok) return;

	// A checkout killed in Git's post-checkout hook can leave its admin dir locked as "initializing".
	// Try the explicit unlock/retry path too; both attempts share one cleanup budget.
	const unlocked = await run(["worktree", "unlock", worktreePath]);
	const retried = await run(removeArgs);
	if (retried?.ok) return;

	const listed = await run(["worktree", "list", "--porcelain", "-z"]);
	const stillRegistered =
		listed?.ok === true &&
		listed.out.split("\0").some((field) => {
			if (!field.startsWith("worktree ")) return false;
			return pathKey(field.slice("worktree ".length)) === pathKey(worktreePath);
		});
	if (listed?.ok && !stillRegistered) {
		// Git has released the registration; only now is it safe to remove any leftover directory.
		try {
			await rm(worktreePath, { recursive: true, force: true });
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			log.warn(`failed to remove unregistered partial worktree ${worktreePath}: ${detail}`);
		}
		return;
	}

	const details = [removed?.err, unlocked?.err, retried?.err, listed?.err]
		.filter(Boolean)
		.join("; ");
	const reason = details || "Git cleanup did not complete within its budget";
	const action = stillRegistered
		? "leaving its directory and registration intact for recovery"
		: "could not verify that Git released the registration; leaving the directory intact";
	log.warn(`failed to remove partial worktree ${worktreePath}; ${action}: ${reason}`);
}
