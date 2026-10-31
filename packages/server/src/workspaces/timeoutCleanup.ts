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

function hasWorktreePath(listed: string, worktreePath: string): boolean {
	return listed.split("\0").some((field) => {
		if (!field.startsWith("worktree ")) return false;
		return pathKey(field.slice("worktree ".length)) === pathKey(worktreePath);
	});
}

function hasWorktreeBranch(listed: string, branch: string): boolean {
	return listed.split("\0").includes(`branch refs/heads/${branch}`);
}

export async function cleanupFailedWorktreeCreate(
	repoPath: string,
	worktreePath: string,
	branch: string,
	branchBaseOid: string,
): Promise<void> {
	const deadline = Date.now() + WORKSPACE_CREATE_CLEANUP_TIMEOUT_MS;
	const remaining = () => Math.max(1, deadline - Date.now());
	const run = async (args: string[]) => {
		if (Date.now() >= deadline) return null;
		return gitAsync(repoPath, args, { timeoutMs: remaining() });
	};
	const removeArgs = ["worktree", "remove", "--force", "--force", worktreePath];
	const removed = await run(removeArgs);
	let unlocked: Awaited<ReturnType<typeof gitAsync>> | null = null;
	let retried: Awaited<ReturnType<typeof gitAsync>> | null = null;
	let listed: Awaited<ReturnType<typeof gitAsync>> | null = null;
	let worktreeReleased = removed?.ok === true;

	if (!worktreeReleased) {
		// A checkout killed in Git's post-checkout hook can leave its admin dir locked as "initializing".
		// Try the explicit unlock/retry path too; all cleanup steps share one budget.
		unlocked = await run(["worktree", "unlock", worktreePath]);
		retried = await run(removeArgs);
		worktreeReleased = retried?.ok === true;
	}

	if (!worktreeReleased) {
		listed = await run(["worktree", "list", "--porcelain", "-z"]);
		if (listed?.ok && !hasWorktreePath(listed.out, worktreePath)) {
			// Git has released the registration; only now is it safe to remove any leftover directory.
			try {
				await rm(worktreePath, { recursive: true, force: true });
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				log.warn(`failed to remove unregistered partial worktree ${worktreePath}: ${detail}`);
			}
			worktreeReleased = true;
		}
	}

	if (!worktreeReleased) {
		const stillRegistered = listed?.ok === true && hasWorktreePath(listed.out, worktreePath);
		const details = [removed?.err, unlocked?.err, retried?.err, listed?.err]
			.filter(Boolean)
			.join("; ");
		const reason = details || "Git cleanup did not complete within its budget";
		const action = stillRegistered
			? "leaving its directory and registration intact for recovery"
			: "could not verify that Git released the registration; leaving the directory intact";
		log.warn(`failed to remove partial worktree ${worktreePath}; ${action}: ${reason}`);
		return;
	}

	const ref = `refs/heads/${branch}`;
	const registrations = await run(["worktree", "list", "--porcelain", "-z"]);
	if (!registrations?.ok) {
		log.warn(`cannot verify registrations for ${worktreePath}; leaving branch ${branch} untouched`);
		return;
	}
	if (hasWorktreePath(registrations.out, worktreePath)) {
		log.warn(`worktree ${worktreePath} remains registered; leaving branch ${branch} untouched`);
		return;
	}
	if (hasWorktreeBranch(registrations.out, branch)) {
		log.warn(`branch ${branch} is still checked out in another worktree; leaving it untouched`);
		return;
	}

	const exists = await run(["show-ref", "--verify", "--quiet", ref]);
	if (!exists?.ok) return;

	const deleted = await run(["update-ref", "-d", ref, branchBaseOid]);
	if (deleted?.ok) return;

	// A missing branch is already clean; a branch that still exists moved or could not be deleted.
	const remains = await run(["show-ref", "--verify", "--quiet", ref]);
	if (remains?.ok) {
		const details = deleted?.err || "the branch moved or Git could not delete it";
		log.warn(`failed to remove leftover branch ${ref} after worktree creation failed: ${details}`);
	}
}
