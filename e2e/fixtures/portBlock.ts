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
// ownership instead: one claim file per slot under $TMPDIR, carrying a stable logical owner key
// plus the real worktree path that determines liveness. Legacy files whose whole content is the
// worktree path remain valid owner records. The hash still picks the *preferred* slot, so the happy
// path stays deterministic and debuggable; the registry skips a genuinely taken slot.
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
// - Breaking is itself serialized and re-verified (review round 4: dead-owner reclamation was a
//   check-then-delete — two waiters could both read one dead owner, and the slower `rm`, acting on
//   its stale decision, deleted the faster one's freshly installed lock). A breaker must first win
//   an exclusive break-token (`mkdir`), then re-read the lock's owner UNDER the token — the kill
//   decision is always made on fresh state, so a successor's live lock is never removed.
// - Break-tokens are NEVER auto-reclaimed (review round 5: aging a token out was itself a
//   stat-then-delete on a mutable path — the same class one level down — and any reclamation
//   primitive would just recurse the problem). This terminates the regress: a token exists for
//   microseconds and is orphaned only by a kill inside that window; an orphaned token only ever
//   BLOCKS breaking (installs don't consult it), and because the token holder keeps the sole break
//   right until its own `rm` fires, a pending removal can only ever hit the dead lock it verified
//   — never a successor's. The degraded case is a LOUD acquire timeout naming the registry for a
//   one-time manual cleanup, never corruption.
// - Belt over the whole protocol: after releasing the lock, the claimant re-reads its slot and
//   retries the transaction if the claim was overwritten — anything unmodeled self-heals at the
//   layer that matters instead of yielding two worktrees on one block.
//
// Residual floor, stated honestly: node/bun expose no OS-death-released lock (`flock`) without
// native deps. What remains is availability-shaped, not correctness-shaped: a pid-reuse or
// orphaned-token wedge parks claims behind a loud, self-describing timeout until a human removes
// the registry dir once.
//
// Allocation under the lock is two-pass: an existing logical-owner claim wins over everything
// (assignments are sticky — a freed lower slot is never migrated to, so a displaced owner can't
// strand its old claim and leak slots; legacy duplicates are deduped to the lowest slot), else the
// scan takes the first slot that is free or stale from `preferredSlot`. A claim whose recorded
// liveness path no longer exists is stale (the worktree was removed) and its slot is reusable.
// Suite teardown never touches the registry — it deliberately outlives runs; it is the memory that
// keeps two live worktrees apart.

export const PORT_BLOCK_BASE = 25000;
export const PORT_BLOCK_STRIDE = 10;
export const PORT_BLOCK_SLOTS = 500;

/** Machine-local registry of claimed slots (one file per slot, content = owner record). */
export const PORT_BLOCK_REGISTRY = join(tmpdir(), "thinkrail-e2e-port-blocks");

/** A stable logical owner can claim independently while sharing a real worktree liveness path.
 * Plain string owners preserve the original `key === livenessPath` per-worktree contract. */
export interface PortBlockOwner {
	key: string;
	livenessPath: string;
}

type PortBlockOwnerInput = string | PortBlockOwner;

/** Age fallback for a garbled lock only (no readable owner — a state the protocol itself cannot
 * produce). Locks with a readable owner are arbitrated by pid liveness; break-tokens are never
 * reclaimed at all (see header). */
const STALE_LOCK_MS = 10_000;

/** Recursive lock-dir removal can transiently report ENOTEMPTY while concurrent claimants inspect it.
 * Node's bounded retry handles exactly that documented rm race without weakening nonce fencing. */
function removeLockTree(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 10 });
}

function slotBase(slot: number): number {
	return PORT_BLOCK_BASE + slot * PORT_BLOCK_STRIDE;
}

function normalizeOwner(owner: PortBlockOwnerInput): PortBlockOwner {
	return typeof owner === "string" ? { key: owner, livenessPath: owner } : owner;
}

/** Read both the original plain-path format and the lane-aware structured format. */
function readClaim(path: string): PortBlockOwner | undefined {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return undefined; // no claim (ENOENT)
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			parsed !== null &&
			typeof parsed === "object" &&
			"key" in parsed &&
			"livenessPath" in parsed &&
			typeof parsed.key === "string" &&
			typeof parsed.livenessPath === "string"
		) {
			return { key: parsed.key, livenessPath: parsed.livenessPath };
		}
	} catch {
		// A legacy claim is a filesystem path, not JSON.
	}
	return { key: raw, livenessPath: raw };
}

function writeClaim(path: string, owner: PortBlockOwner): void {
	writeFileSync(path, owner.key === owner.livenessPath ? owner.key : JSON.stringify(owner));
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

/** Remove `path` if its recorded mtime is older than STALE_LOCK_MS; `true` if it was removed.
 * (Missing/vanished paths report `false` — the caller just retries its loop.) */
function removeIfAged(path: string): boolean {
	let ageMs = Number.NaN;
	try {
		ageMs = Date.now() - statSync(path).mtimeMs;
	} catch {
		return false; // vanished — nothing to remove
	}
	if (ageMs > STALE_LOCK_MS) {
		removeLockTree(path);
		return true;
	}
	return false;
}

/**
 * Try to break a dead or garbled lock — the ONLY code path that may remove a lock it does not own.
 * Serialized by an exclusive break-token (`mkdir` — single winner), and the removal decision is
 * re-made on freshly read state UNDER the token, so a waiter's earlier, stale "it is dead" reading
 * can never delete a successor's live lock (review round 4). Tokens are never reclaimed — an
 * orphaned one wedges breaking into the acquire timeout's loud manual-cleanup path rather than
 * reopening a reclamation race (round 5). Exported for the forced interleaving tests.
 */
export function tryBreakLock(lockPath: string): void {
	const tokenPath = `${lockPath}.break`;
	try {
		mkdirSync(tokenPath); // exclusive: one breaker at a time
	} catch {
		return; // a breaker is at work (or an orphaned token wedges us — surfaced at acquire timeout)
	}
	try {
		const owner = readLockOwner(lockPath);
		if (owner !== undefined) {
			if (!pidAlive(owner.pid)) removeLockTree(lockPath); // provably dead
			return; // alive — never usurped
		}
		removeIfAged(lockPath); // garbled (ownerless) — the protocol can't produce this; age it out
	} finally {
		removeLockTree(tokenPath);
	}
}

/**
 * Take the registry's exclusive lock. The lock is a `.lock` dir carrying its owner record, moved
 * into place with `rename` (atomic; refuses to replace a non-empty dir). Breaking is delegated to
 * `tryBreakLock` (dead owner ⇒ broken now; live owner ⇒ wait, then throw loudly at `timeoutMs`;
 * garbled ⇒ broken only past STALE_LOCK_MS).
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
				tryBreakLock(lockPath);
				if (Date.now() >= deadline) {
					const owner = readLockOwner(lockPath);
					const holder =
						owner === undefined
							? "an unreadable owner"
							: pidAlive(owner.pid)
								? `live pid ${owner.pid}`
								: `dead pid ${owner.pid}; breaking is wedged — likely an orphaned break-token`;
					throw new Error(
						`timed out acquiring the e2e port-block registry lock at ${lockPath} (held by ${holder});` +
							` if no e2e run is active, remove ${registryDir} and retry`,
					);
				}
				spinFor(10);
			}
		}
	} catch (error) {
		removeLockTree(prepPath); // the staged, never-installed lock
		throw error;
	}
}

/** Fenced release: only the acquisition that owns the lock (by nonce) may remove it — a process
 * resuming after a suspension can never delete a successor's mutex. */
function releaseRegistryLock(lockPath: string, nonce: string): void {
	if (readLockOwner(lockPath)?.nonce === nonce) {
		removeLockTree(lockPath);
	}
}

/** Numerically sorted slot numbers present in the registry (ignores lock artifacts). */
function claimedSlots(registryDir: string): number[] {
	return readdirSync(registryDir)
		.filter((name) => /^\d+$/.test(name))
		.map(Number)
		.sort((a, b) => a - b);
}

/** One locked claim transaction; returns the slot. (See `claimPortBlock` for the semantics.) */
function claimSlotOnce(
	owner: PortBlockOwner,
	preferredSlot: number,
	registryDir: string,
	lockTimeoutMs: number,
): number {
	const lock = acquireRegistryLock(registryDir, lockTimeoutMs);
	try {
		// Pass 1: this logical owner's existing claim wins over everything — even a now-free lower
		// slot — so assignments never migrate (migration would strand the old claim and leak its slot).
		const [mine, ...duplicates] = claimedSlots(registryDir).filter(
			(slot) => readClaim(join(registryDir, String(slot)))?.key === owner.key,
		);
		if (mine !== undefined) {
			for (const extra of duplicates) rmSync(join(registryDir, String(extra)), { force: true });
			return mine;
		}

		// Pass 2: allocate — first slot from `preferredSlot` that is free, or stale (its recorded
		// liveness path is gone). Plain overwrite is safe here: the lock serializes the transaction.
		for (let attempt = 0; attempt < PORT_BLOCK_SLOTS; attempt++) {
			const slot = (preferredSlot + attempt) % PORT_BLOCK_SLOTS;
			const claimPath = join(registryDir, String(slot));
			const claim = readClaim(claimPath);
			if (claim !== undefined && existsSync(claim.livenessPath)) continue;
			writeClaim(claimPath, owner);
			return slot;
		}
		throw new Error(
			`no free e2e port block (${PORT_BLOCK_SLOTS} slots all claimed by live worktrees) — inspect ${registryDir}`,
		);
	} finally {
		releaseRegistryLock(lock.lockPath, lock.nonce);
	}
}

/**
 * Claim a port block for `owner` and return its base port. A string keeps the original per-worktree
 * contract; `{ key, livenessPath }` lets independent lanes keep stable claims whose staleness still
 * follows the real worktree. An existing key always wins (sticky); otherwise the scan starts at
 * `preferredSlot` and takes the first slot that is unclaimed or stale. After releasing the lock the
 * claim is re-read and the transaction retries if it was overwritten (the belt over the lock
 * protocol — see the header).
 */
export function claimPortBlock(
	ownerInput: PortBlockOwnerInput,
	preferredSlot: number,
	registryDir: string = PORT_BLOCK_REGISTRY,
	lockTimeoutMs = 15_000,
): number {
	const owner = normalizeOwner(ownerInput);
	mkdirSync(registryDir, { recursive: true });
	for (let round = 0; round < 5; round++) {
		const slot = claimSlotOnce(owner, preferredSlot, registryDir, lockTimeoutMs);
		if (readClaim(join(registryDir, String(slot)))?.key === owner.key) return slotBase(slot);
	}
	throw new Error(
		`e2e port-block claim did not settle after 5 rounds (mutual-exclusion failure?) — inspect ${registryDir}`,
	);
}
