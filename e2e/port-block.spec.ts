import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	claimPortBlock,
	PORT_BLOCK_BASE,
	PORT_BLOCK_SLOTS,
	PORT_BLOCK_STRIDE,
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

test("a stale claim (its worktree path is gone) is reclaimed", () => {
	const { registry, rootA } = setup();
	writeFileSync(join(registry, "5"), join(tmpdir(), "port-block-vanished-worktree"));
	expect(claimPortBlock(rootA, 5, registry)).toBe(base(5));
	expect(readFileSync(join(registry, "5"), "utf8")).toBe(rootA);
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

test("a stale registry lock (crashed holder) is broken, not waited out", () => {
	const { registry, rootA } = setup();
	const lock = join(registry, ".lock");
	mkdirSync(lock);
	const old = (Date.now() - 60_000) / 1000; // held for a minute — far beyond any live transaction
	utimesSync(lock, old, old);
	expect(claimPortBlock(rootA, 1, registry)).toBe(base(1));
});

test("a fresh registry lock blocks the claim until the timeout, then throws loudly", () => {
	const { registry, rootA } = setup();
	mkdirSync(join(registry, ".lock")); // a live holder that never releases
	expect(() => claimPortBlock(rootA, 1, registry, 50)).toThrow(/port-block registry lock/);
});
