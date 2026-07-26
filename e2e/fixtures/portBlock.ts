import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Atomic per-worktree port-block allocation (review-hardened: a pure path hash over a finite slot
// space can land two worktrees on the same block, and under that collision the binary suite's
// failure shape is SILENT — its CLI free-scans past the taken port while Playwright polls the
// expected one, which the other worktree's host answers). A tiny machine-local registry arbitrates
// ownership instead: one claim file per slot under $TMPDIR, its content = the owning worktree's
// repo root. The hash still picks the *preferred* slot, so the happy path stays deterministic and
// debuggable; the registry only steps in to detect and skip a genuinely taken slot.
//
// Properties:
// - Atomic: claims are created with `wx` (O_EXCL) — the filesystem arbitrates races; a loser
//   re-reads and either converges (same worktree, another process) or moves to the next slot.
// - Stable: a worktree's claim persists across runs, so the runner, its workers, global setup, and
//   later runs all agree on the same block without coordination.
// - Self-cleaning: a claim whose recorded worktree path no longer exists is stale (the worktree was
//   removed) and is reclaimed on the next allocation that wants its slot.
// - Never wiped by suite teardown: the registry deliberately outlives runs — it is the memory that
//   keeps two live worktrees apart.

export const PORT_BLOCK_BASE = 25000;
export const PORT_BLOCK_STRIDE = 10;
export const PORT_BLOCK_SLOTS = 500;

/** Machine-local registry of claimed slots (one file per slot, content = owner repo root). */
export const PORT_BLOCK_REGISTRY = join(tmpdir(), "thinkrail-e2e-port-blocks");

function slotBase(slot: number): number {
	return PORT_BLOCK_BASE + slot * PORT_BLOCK_STRIDE;
}

function readClaim(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined; // no claim (ENOENT)
	}
}

/**
 * Claim a port block for `repoRoot`, starting at `preferredSlot` (its path hash) and scanning
 * forward past slots owned by other live worktrees. Returns the block's base port. Throws only in
 * the practically-impossible case of every slot being owned by a live worktree.
 */
export function claimPortBlock(
	repoRoot: string,
	preferredSlot: number,
	registryDir: string = PORT_BLOCK_REGISTRY,
): number {
	mkdirSync(registryDir, { recursive: true });
	for (let attempt = 0; attempt < PORT_BLOCK_SLOTS; attempt++) {
		const slot = (preferredSlot + attempt) % PORT_BLOCK_SLOTS;
		const claimPath = join(registryDir, String(slot));

		const owner = readClaim(claimPath);
		if (owner === repoRoot) return slotBase(slot); // ours from an earlier run/process
		if (owner !== undefined) {
			if (existsSync(owner)) continue; // live claim by another worktree — next slot
			rmSync(claimPath, { force: true }); // stale — its worktree is gone; reclaim below
		}

		try {
			writeFileSync(claimPath, repoRoot, { flag: "wx" }); // O_EXCL: the atomic arbiter
			return slotBase(slot);
		} catch {
			// Lost the creation race. If the winner is this same worktree (another of our processes),
			// converge on the slot; otherwise move on.
			if (readClaim(claimPath) === repoRoot) return slotBase(slot);
		}
	}
	throw new Error(
		`no free e2e port block (${PORT_BLOCK_SLOTS} slots all claimed by live worktrees) — inspect ${registryDir}`,
	);
}
