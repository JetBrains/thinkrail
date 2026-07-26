import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
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
// The whole claim transaction is serialized by an interprocess mkdir-lock (review round 2): an
// unserialized read→reclaim→create dance has a real TOCTOU — two processes can both judge one claim
// stale, and the slower `rm` then deletes the faster one's FRESH claim, putting two worktrees on
// one block. Under the lock, allocation is two-pass: an existing claim for this worktree wins over
// everything (assignments are sticky — a freed lower slot is never migrated to, so a displaced
// worktree can't strand its old claim and leak slots), else the scan takes the first slot that is
// free or stale from `preferredSlot`.
//
// Properties:
// - Serialized: one process mutates the registry at a time (`mkdir` is the atomic arbiter; a lock
//   left by a crashed process is broken after STALE_LOCK_MS — it guards a sub-millisecond
//   transaction, so an old lock means a dead holder).
// - Stable and one-to-one: a worktree keeps its slot across runs and processes (runner, workers,
//   global setup, and later runs all agree with no coordination), and duplicate claims from any
//   older protocol are cleaned on sight.
// - Self-cleaning: a claim whose recorded worktree path no longer exists is stale (the worktree was
//   removed) and its slot is reusable.
// - Never wiped by suite teardown: the registry deliberately outlives runs — it is the memory that
//   keeps two live worktrees apart.

export const PORT_BLOCK_BASE = 25000;
export const PORT_BLOCK_STRIDE = 10;
export const PORT_BLOCK_SLOTS = 500;

/** Machine-local registry of claimed slots (one file per slot, content = owner repo root). */
export const PORT_BLOCK_REGISTRY = join(tmpdir(), "thinkrail-e2e-port-blocks");

/** A held lock older than this is a crashed holder's leftover, not a live transaction. */
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

/** Take the registry's exclusive lock (a `.lock` dir — `mkdir` is atomic), breaking stale ones. */
function acquireRegistryLock(registryDir: string, timeoutMs: number): string {
	const lockPath = join(registryDir, ".lock");
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			mkdirSync(lockPath); // non-recursive: throws EEXIST while another process holds it
			return lockPath;
		} catch {
			let ageMs = Number.NaN;
			try {
				ageMs = Date.now() - statSync(lockPath).mtimeMs;
			} catch {
				ageMs = Number.NaN; // lock vanished between mkdir and stat — retry immediately
			}
			if (ageMs > STALE_LOCK_MS) {
				rmSync(lockPath, { recursive: true, force: true });
				continue;
			}
			if (Date.now() >= deadline) {
				throw new Error(`timed out acquiring the e2e port-block registry lock at ${lockPath}`);
			}
			spinFor(10);
		}
	}
}

/** Numerically sorted slot numbers present in the registry (ignores the `.lock` dir). */
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
	const lockPath = acquireRegistryLock(registryDir, lockTimeoutMs);
	try {
		// Pass 1: this worktree's existing claim wins over everything — even a now-free lower slot —
		// so assignments never migrate (migration would strand the old claim and leak its slot).
		// Duplicates (possible only as leftovers of a raced legacy protocol) are cleaned, keeping the
		// lowest slot for determinism.
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
		rmSync(lockPath, { recursive: true, force: true });
	}
}
