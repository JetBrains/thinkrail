import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	claimPortBlock,
	PORT_BLOCK_BASE,
	PORT_BLOCK_SLOTS,
	PORT_BLOCK_STRIDE,
	tryBreakLock,
} from "./fixtures/portBlock";

// Pins the atomic port-block claim contract (fixtures/portBlock.ts) — the arbiter that keeps two
// live worktrees off the same port block even when their path hashes prefer the same slot (the
// review-flagged residual: under such a collision the binary suite's failure shape is silent).
// Pure node, no page/host involved — runs with the suite because e2e/ is where the fixture lives.

/** A fresh registry + two existing fake "worktree roots" per test — nothing machine-global. */
function setup() {
	const registry = mkdtempSync(join(tmpdir(), "port-block-registry-"));
	const rootA = mkdtempSync(join(tmpdir(), "port-block-root-a-"));
	const rootB = mkdtempSync(join(tmpdir(), "port-block-root-b-"));
	return { registry, rootA, rootB };
}

const base = (slot: number) => PORT_BLOCK_BASE + slot * PORT_BLOCK_STRIDE;

test("same worktree converges on the same block, across repeated claims", () => {
	const { registry, rootA } = setup();
	const first = claimPortBlock(rootA, 7, registry);
	expect(first).toBe(base(7));
	expect(claimPortBlock(rootA, 7, registry)).toBe(first); // another process / a later run
});

test("two live worktrees preferring the same slot get distinct blocks", () => {
	const { registry, rootA, rootB } = setup();
	const a = claimPortBlock(rootA, 42, registry);
	const b = claimPortBlock(rootB, 42, registry);
	expect(a).toBe(base(42));
	expect(b).toBe(base(43)); // scanned past the live claim
	// And each keeps its own block on re-claim — the registry is stable, not first-come-shuffled.
	expect(claimPortBlock(rootA, 42, registry)).toBe(a);
	expect(claimPortBlock(rootB, 42, registry)).toBe(b);
});

test("logical lanes on one live worktree get distinct sticky blocks", () => {
	const { registry, rootA } = setup();
	const laneA = { key: `${rootA}#lane-0`, livenessPath: rootA };
	const laneB = { key: `${rootA}#lane-1`, livenessPath: rootA };
	const a = claimPortBlock(laneA, 5, registry);
	const b = claimPortBlock(laneB, 5, registry);
	expect(a).toBe(base(5));
	expect(b).toBe(base(6));
	expect(claimPortBlock(laneA, 5, registry)).toBe(a);
	expect(claimPortBlock(laneB, 5, registry)).toBe(b);
	expect(JSON.parse(readFileSync(join(registry, "5"), "utf8"))).toEqual(laneA);
});

test("a stale claim (its worktree path is gone) is reclaimed", () => {
	const { registry, rootA } = setup();
	writeFileSync(join(registry, "5"), join(tmpdir(), "port-block-vanished-worktree"));
	expect(claimPortBlock(rootA, 5, registry)).toBe(base(5));
	expect(readFileSync(join(registry, "5"), "utf8")).toBe(rootA);
});

test("a logical lane becomes stale with its real worktree, not its synthetic key", () => {
	const { registry, rootA, rootB } = setup();
	const lane = { key: `${rootA}#lane-0`, livenessPath: rootA };
	expect(claimPortBlock(lane, 8, registry)).toBe(base(8));
	// The key is deliberately not a real path; the existing worktree keeps the claim alive.
	expect(claimPortBlock(rootB, 8, registry)).toBe(base(9));
	rmSync(rootA, { recursive: true, force: true });
	const rootC = mkdtempSync(join(tmpdir(), "port-block-root-c-"));
	expect(claimPortBlock(rootC, 8, registry)).toBe(base(8));
});

test("assignments are sticky: a displaced worktree never migrates to its freed predecessor slot", () => {
	// Review scenario: A owns B's preferred slot, so B is displaced; A's worktree is then removed.
	// B must KEEP its slot (migrating would strand B's old claim as a live-looking leak), while a
	// newcomer is free to reclaim the stale slot.
	const { registry, rootA, rootB } = setup();
	expect(claimPortBlock(rootA, 42, registry)).toBe(base(42));
	expect(claimPortBlock(rootB, 42, registry)).toBe(base(43)); // displaced
	rmSync(rootA, { recursive: true, force: true }); // A's worktree is deleted
	expect(claimPortBlock(rootB, 42, registry)).toBe(base(43)); // sticky — no migration to 42
	const rootC = mkdtempSync(join(tmpdir(), "port-block-root-c-"));
	expect(claimPortBlock(rootC, 42, registry)).toBe(base(42)); // newcomer reclaims the stale slot
	expect(claimPortBlock(rootB, 42, registry)).toBe(base(43)); // still exactly one claim per root
});

test("duplicate claims for one worktree are deduped to the lowest slot", () => {
	const { registry, rootA } = setup();
	writeFileSync(join(registry, "9"), rootA);
	writeFileSync(join(registry, "3"), rootA);
	expect(claimPortBlock(rootA, 7, registry)).toBe(base(3));
	expect(claimPortBlock(rootA, 7, registry)).toBe(base(3)); // and stays there
	expect(() => readFileSync(join(registry, "9"), "utf8")).toThrow(); // the extra claim is gone
});

test("slot scan wraps past the last slot", () => {
	const { registry, rootA, rootB } = setup();
	const last = PORT_BLOCK_SLOTS - 1;
	expect(claimPortBlock(rootA, last, registry)).toBe(base(last));
	expect(claimPortBlock(rootB, last, registry)).toBe(PORT_BLOCK_BASE); // wrapped to slot 0
});

test("a missing registry dir is created on first claim", () => {
	const { registry, rootA } = setup();
	const nested = join(registry, "not", "yet", "there");
	mkdirSync(join(registry, "not"), { recursive: true }); // parent exists, leaf doesn't
	expect(claimPortBlock(rootA, 0, nested)).toBe(PORT_BLOCK_BASE);
});

/** A lock dir as the protocol creates it: non-empty, carrying an owner record. */
function plantLock(registry: string, owner: string): string {
	const lock = join(registry, ".lock");
	mkdirSync(lock);
	writeFileSync(join(lock, "owner"), owner);
	return lock;
}

test("a crashed holder's lock (dead pid) is broken immediately, not waited out", () => {
	const { registry, rootA } = setup();
	// A real pid that is provably dead: spawn a no-op child and wait for it to exit.
	const deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
	plantLock(registry, JSON.stringify({ pid: deadPid, nonce: "gone" }));
	expect(claimPortBlock(rootA, 1, registry, 1_000)).toBe(base(1)); // far under the age fallback
});

test("a live holder is never usurped — the claim times out loudly instead", () => {
	const { registry, rootA } = setup();
	plantLock(registry, JSON.stringify({ pid: process.pid, nonce: "held" })); // us: alive by definition
	expect(() => claimPortBlock(rootA, 1, registry, 50)).toThrow(/held by live pid/);
});

test("breaking is serialized: a foreign break-token wedges breaking into the loud timeout", () => {
	const { registry, rootA } = setup();
	const deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
	const lock = plantLock(registry, JSON.stringify({ pid: deadPid, nonce: "gone" }));
	const token = join(registry, ".lock.break");
	mkdirSync(token); // another breaker mid-flight — breaking must wait, not proceed unserialized
	expect(() => claimPortBlock(rootA, 1, registry, 50)).toThrow(/remove .* and retry/);
	expect(existsSync(lock)).toBe(true); // the dead lock was NOT touched while the token existed
	const old = (Date.now() - 60_000) / 1000;
	utimesSync(token, old, old);
	// Even an ancient orphaned token is never auto-reclaimed (round 5: reclamation is itself a race)
	// — the wedge stays loud and self-describing until the documented manual cleanup.
	expect(() => claimPortBlock(rootA, 1, registry, 50)).toThrow(/orphaned break-token/);
	rmSync(token, { recursive: true, force: true }); // the manual cleanup the error names
	expect(claimPortBlock(rootA, 1, registry)).toBe(base(1));
});

test("forced two-reclaimer interleaving: a stale break decision cannot delete a successor's lock", () => {
	// Review round 4's exact scenario, driven through the real break routine: reclaimers A and B both
	// observed a dead owner; A breaks the lock and a successor installs a fresh one; B's break —
	// executing its stale decision — must re-verify under the token and leave the successor alone.
	const { registry, rootB } = setup();
	const deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
	const lock = plantLock(registry, JSON.stringify({ pid: deadPid, nonce: "gone" })); // both read this
	tryBreakLock(lock); // reclaimer A acts: the dead lock is gone
	expect(existsSync(lock)).toBe(false);
	plantLock(registry, JSON.stringify({ pid: process.pid, nonce: "successor" })); // successor installs
	tryBreakLock(lock); // reclaimer B acts on its STALE decision
	expect(readFileSync(join(lock, "owner"), "utf8")).toContain('"successor"'); // untouched
	expect(() => claimPortBlock(rootB, 1, registry, 50)).toThrow(/held by live pid/); // still exclusive
});

test("a garbled lock (unreadable owner) is broken only once it is old", () => {
	const { registry, rootA } = setup();
	const lock = plantLock(registry, "not json at all");
	expect(() => claimPortBlock(rootA, 1, registry, 50)).toThrow(/unreadable owner/); // fresh: wait, then loud
	const old = (Date.now() - 60_000) / 1000; // far beyond any live transaction
	utimesSync(lock, old, old);
	expect(claimPortBlock(rootA, 1, registry)).toBe(base(1)); // old: the age fallback breaks it
});
