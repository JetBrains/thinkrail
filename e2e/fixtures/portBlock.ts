import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Atomic per-worktree port-block allocation (review-hardened: a pure path hash over a finite slot
// space can land two worktrees on the same block, and under that collision the binary suite's
// failure shape is SILENT — its CLI free-scans past the taken port while Playwright polls the
// expected one, which the other worktree's host answers). A tiny machine-local registry arbitrates
// ownership instead: one claim file per slot under $TMPDIR, its content = the owning worktree's
// repo root. The hash still picks the *preferred* slot, so the happy path stays deterministic and
// debuggable; the registry steps in to detect and skip a genuinely taken slot.
//
// The whole claim transaction is serialized by an interprocess lock (review round 2: an
// unserialized read→reclaim→create dance has a real TOCTOU — two processes can both judge one claim
// stale, and the slower `rm` then deletes the faster one's FRESH claim, putting two worktrees on
// one block). The lock itself is liveness-arbitrated, not age-arbitrated (review round 3: elapsed
// time is not proof a holder died — a descheduled/suspended holder would resume inside the critical
// section after an age-based break, and an unconditional release would then delete the NEW owner's
// lock):
// - A lock is born atomically WITH its owner record ({pid, nonce}, staged then `rename`d into
//   place — `rename` refuses to replace a non-empty dir, so there is no created-but-ownerless
//   window and the filesystem stays the arbiter).
// - A held lock is broken ONLY when its recorded pid is provably not running (`kill(pid, 0)` →
//   ESRCH) — a crashed holder is broken immediately, a live-but-suspended holder is never usurped
//   (waiters time out LOUDLY instead; pid reuse degrades the same way: a conservative loud wait,
//   never a broken mutex). Age (STALE_LOCK_MS) remains only for a garbled lock with no readable
//   owner, which the protocol itself can never produce.
// - Release is fenced by the nonce: a process only removes the lock if it still owns it, so no
//   resume-after-suspension interleaving can delete a successor's mutex.
//
// Allocation under the lock is two-pass: an existing claim for this worktree wins over everything
// (assignments are sticky — a freed lower slot is never migrated to, so a displaced worktree can't
// strand its old claim and leak slots; legacy duplicates are deduped to the lowest slot), else the
// scan takes the first slot that is free or stale from `preferredSlot`. A claim whose recorded
// worktree path no longer exists is stale (the worktree was removed) and its slot is reusable.
// Suite teardown never touches the registry — it deliberately outlives runs; it is the memory that
// keeps two live worktrees apart.

export const PORT_BLOCK_BASE = 25000;
export const PORT_BLOCK_STRIDE = 10;
export const PORT_BLOCK_SLOTS = 500;

/** Machine-local registry of claimed slots (one file per slot, content = owner repo root). */
export const PORT_BLOCK_REGISTRY = join(tmpdir(), "thinkrail-e2e-port-blocks");

/** Fallback for a garbled lock only (no readable owner): older than this ⇒ break. A lock with a
 * readable owner is arbitrated by pid liveness, never by age. */
const STALE_LOCK_MS = 10_000;

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

/** Burn ~`ms` between lock attempts — sync on purpose: callers claim at module load. */
function spinFor(ms: number): void {
	const until = Date.now() + ms;
	let noop = 0;
	while (Date.now() < until) noop += 1;
	void noop;
}

interface LockOwner {
	pid: number;
	nonce: string;
}

function readLockOwner(lockPath: string): LockOwner | undefined {
	try {
		const parsed = JSON.parse(readFileSync(join(lockPath, "owner"), "utf8")) as unknown;
		if (parsed !== null && typeof parsed === "object" && "pid" in parsed && "nonce" in parsed) {
			const { pid, nonce } = parsed;
			if (typeof pid === "number" && typeof nonce === "string") return { pid, nonce };
		}
		return undefined; // garbled content
	} catch {
		return undefined; // lock gone, or owner unreadable
	}
}

/** Is `pid` a running process? (EPERM = running under another user — conservatively alive.) */
function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = error instanceof Error && "code" in error ? error.code : undefined;
		return code === "EPERM";
	}
}

/**
 * Take the registry's exclusive lock. The lock is a `.lock` dir carrying its owner record, moved
 * into place with `rename` (atomic; refuses to replace a non-empty dir). Breaking rules: recorded
 * owner provably dead ⇒ break now; owner alive ⇒ wait, then throw loudly at `timeoutMs`; no
 * readable owner ⇒ break only past STALE_LOCK_MS.
 */
function acquireRegistryLock(
	registryDir: string,
	timeoutMs: number,
): { lockPath: string; nonce: string } {
	const lockPath = join(registryDir, ".lock");
	const nonce = randomUUID();
	const prepPath = join(registryDir, `.lock-prep-${nonce}`);
	mkdirSync(prepPath);
	writeFileSync(join(prepPath, "owner"), JSON.stringify({ pid: process.pid, nonce }));
	const deadline = Date.now() + timeoutMs;
	try {
		for (;;) {
			try {
				renameSync(prepPath, lockPath);
				return { lockPath, nonce };
			} catch {
				const owner = readLockOwner(lockPath);
				if (owner !== undefined) {
					if (!pidAlive(owner.pid)) {
						rmSync(lockPath, { recursive: true, force: true }); // crashed holder — break now
						continue;
					}
				} else {
					let ageMs = Number.NaN;
					try {
						ageMs = Date.now() - statSync(lockPath).mtimeMs;
					} catch {
						continue; // lock vanished between rename and stat — retry immediately
					}
					if (ageMs > STALE_LOCK_MS) {
						rmSync(lockPath, { recursive: true, force: true }); // garbled and old — break
						continue;
					}
				}
				if (Date.now() >= deadline) {
					throw new Error(
						`timed out acquiring the e2e port-block registry lock at ${lockPath}` +
							` (held by ${owner === undefined ? "an unreadable owner" : `live pid ${owner.pid}`})`,
					);
				}
				spinFor(10);
			}
		}
	} catch (error) {
		rmSync(prepPath, { recursive: true, force: true }); // the staged, never-installed lock
		throw error;
	}
}

/** Fenced release: only the acquisition that owns the lock (by nonce) may remove it — a process
 * resuming after a suspension can never delete a successor's mutex. */
function releaseRegistryLock(lockPath: string, nonce: string): void {
	if (readLockOwner(lockPath)?.nonce === nonce) {
		rmSync(lockPath, { recursive: true, force: true });
	}
}

/** Numerically sorted slot numbers present in the registry (ignores lock artifacts). */
function claimedSlots(registryDir: string): number[] {
	return readdirSync(registryDir)
		.filter((name) => /^\d+$/.test(name))
		.map(Number)
		.sort((a, b) => a - b);
}

/**
 * Claim a port block for `repoRoot` and return its base port. An existing claim for `repoRoot`
 * always wins (sticky); otherwise the scan starts at `preferredSlot` (its path hash) and takes the
 * first slot that is unclaimed or whose claim is stale. Throws only when every slot is owned by a
 * live worktree (practically impossible) or the registry lock cannot be acquired.
 */
export function claimPortBlock(
	repoRoot: string,
	preferredSlot: number,
	registryDir: string = PORT_BLOCK_REGISTRY,
	lockTimeoutMs = 15_000,
): number {
	mkdirSync(registryDir, { recursive: true });
	const lock = acquireRegistryLock(registryDir, lockTimeoutMs);
	try {
		// Pass 1: this worktree's existing claim wins over everything — even a now-free lower slot —
		// so assignments never migrate (migration would strand the old claim and leak its slot).
		const [mine, ...duplicates] = claimedSlots(registryDir).filter(
			(slot) => readClaim(join(registryDir, String(slot))) === repoRoot,
		);
		if (mine !== undefined) {
			for (const extra of duplicates) rmSync(join(registryDir, String(extra)), { force: true });
			return slotBase(mine);
		}

		// Pass 2: allocate — first slot from `preferredSlot` that is free, or stale (its recorded
		// worktree path is gone). Plain overwrite is safe here: the lock serializes the transaction.
		for (let attempt = 0; attempt < PORT_BLOCK_SLOTS; attempt++) {
			const slot = (preferredSlot + attempt) % PORT_BLOCK_SLOTS;
			const claimPath = join(registryDir, String(slot));
			const owner = readClaim(claimPath);
			if (owner !== undefined && existsSync(owner)) continue; // live claim by another worktree
			writeFileSync(claimPath, repoRoot);
			return slotBase(slot);
		}
		throw new Error(
			`no free e2e port block (${PORT_BLOCK_SLOTS} slots all claimed by live worktrees) — inspect ${registryDir}`,
		);
	} finally {
		releaseRegistryLock(lock.lockPath, lock.nonce);
	}
}
