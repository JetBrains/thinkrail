import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

test("same worktree converges on the same block, across repeated claims", () => {
	const { registry, rootA } = setup();
	const first = claimPortBlock(rootA, 7, registry);
	expect(first).toBe(PORT_BLOCK_BASE + 7 * PORT_BLOCK_STRIDE);
	expect(claimPortBlock(rootA, 7, registry)).toBe(first); // another process / a later run
});

test("two live worktrees preferring the same slot get distinct blocks", () => {
	const { registry, rootA, rootB } = setup();
	const a = claimPortBlock(rootA, 42, registry);
	const b = claimPortBlock(rootB, 42, registry);
	expect(a).toBe(PORT_BLOCK_BASE + 42 * PORT_BLOCK_STRIDE);
	expect(b).toBe(PORT_BLOCK_BASE + 43 * PORT_BLOCK_STRIDE); // scanned past the live claim
	// And each keeps its own block on re-claim — the registry is stable, not first-come-shuffled.
	expect(claimPortBlock(rootA, 42, registry)).toBe(a);
	expect(claimPortBlock(rootB, 42, registry)).toBe(b);
});

test("a stale claim (its worktree path is gone) is reclaimed", () => {
	const { registry, rootA } = setup();
	writeFileSync(join(registry, "5"), join(tmpdir(), "port-block-vanished-worktree"));
	expect(claimPortBlock(rootA, 5, registry)).toBe(PORT_BLOCK_BASE + 5 * PORT_BLOCK_STRIDE);
	expect(readFileSync(join(registry, "5"), "utf8")).toBe(rootA);
});

test("slot scan wraps past the last slot", () => {
	const { registry, rootA, rootB } = setup();
	const last = PORT_BLOCK_SLOTS - 1;
	expect(claimPortBlock(rootA, last, registry)).toBe(PORT_BLOCK_BASE + last * PORT_BLOCK_STRIDE);
	expect(claimPortBlock(rootB, last, registry)).toBe(PORT_BLOCK_BASE); // wrapped to slot 0
});

test("a missing registry dir is created on first claim", () => {
	const { registry, rootA } = setup();
	const nested = join(registry, "not", "yet", "there");
	mkdirSync(join(registry, "not"), { recursive: true }); // parent exists, leaf doesn't
	expect(claimPortBlock(rootA, 0, nested)).toBe(PORT_BLOCK_BASE);
});
