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
	expect(claimPortBlock(rootA, 7, registry)).toBe(first);
});

test("two live worktrees preferring the same slot get distinct blocks", () => {
	const { registry, rootA, rootB } = setup();
	const a = claimPortBlock(rootA, 42, registry);
	const b = claimPortBlock(rootB, 42, registry);
	expect(a).toBe(base(42));
	expect(b).toBe(base(43));
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
	expect(claimPortBlock(rootB, 8, registry)).toBe(base(9));
	rmSync(rootA, { recursive: true, force: true });
	const rootC = mkdtempSync(join(tmpdir(), "port-block-root-c-"));
	expect(claimPortBlock(rootC, 8, registry)).toBe(base(8));
});

test("assignments are sticky: a displaced worktree never migrates to its freed predecessor slot", () => {
	const { registry, rootA, rootB } = setup();
	expect(claimPortBlock(rootA, 42, registry)).toBe(base(42));
	expect(claimPortBlock(rootB, 42, registry)).toBe(base(43));
	rmSync(rootA, { recursive: true, force: true });
	expect(claimPortBlock(rootB, 42, registry)).toBe(base(43));
	const rootC = mkdtempSync(join(tmpdir(), "port-block-root-c-"));
	expect(claimPortBlock(rootC, 42, registry)).toBe(base(42));
	expect(claimPortBlock(rootB, 42, registry)).toBe(base(43));
});

test("duplicate claims for one worktree are deduped to the lowest slot", () => {
	const { registry, rootA } = setup();
	writeFileSync(join(registry, "9"), rootA);
	writeFileSync(join(registry, "3"), rootA);
	expect(claimPortBlock(rootA, 7, registry)).toBe(base(3));
	expect(claimPortBlock(rootA, 7, registry)).toBe(base(3));
	expect(() => readFileSync(join(registry, "9"), "utf8")).toThrow();
});

test("slot scan wraps past the last slot", () => {
	const { registry, rootA, rootB } = setup();
	const last = PORT_BLOCK_SLOTS - 1;
	expect(claimPortBlock(rootA, last, registry)).toBe(base(last));
	expect(claimPortBlock(rootB, last, registry)).toBe(PORT_BLOCK_BASE);
});

test("a missing registry dir is created on first claim", () => {
	const { registry, rootA } = setup();
	const nested = join(registry, "not", "yet", "there");
	mkdirSync(join(registry, "not"), { recursive: true });
	expect(claimPortBlock(rootA, 0, nested)).toBe(PORT_BLOCK_BASE);
});

function plantLock(registry: string, owner: string): string {
	const lock = join(registry, ".lock");
	mkdirSync(lock);
	writeFileSync(join(lock, "owner"), owner);
	return lock;
}

test("a crashed holder's lock (dead pid) is broken immediately, not waited out", () => {
	const { registry, rootA } = setup();
	const deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
	plantLock(registry, JSON.stringify({ pid: deadPid, nonce: "gone" }));
	expect(claimPortBlock(rootA, 1, registry, 1_000)).toBe(base(1));
});

test("a live holder is never usurped — the claim times out loudly instead", () => {
	const { registry, rootA } = setup();
	plantLock(registry, JSON.stringify({ pid: process.pid, nonce: "held" }));
	expect(() => claimPortBlock(rootA, 1, registry, 50)).toThrow(/held by live pid/);
});

test("breaking is serialized: a foreign break-token wedges breaking into the loud timeout", () => {
	const { registry, rootA } = setup();
	const deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
	const lock = plantLock(registry, JSON.stringify({ pid: deadPid, nonce: "gone" }));
	const token = join(registry, ".lock.break");
	mkdirSync(token);
	expect(() => claimPortBlock(rootA, 1, registry, 50)).toThrow(/remove .* and retry/);
	expect(existsSync(lock)).toBe(true);
	const old = (Date.now() - 60_000) / 1000;
	utimesSync(token, old, old);
	expect(() => claimPortBlock(rootA, 1, registry, 50)).toThrow(/orphaned break-token/);
	rmSync(token, { recursive: true, force: true });
	expect(claimPortBlock(rootA, 1, registry)).toBe(base(1));
});

test("forced two-reclaimer interleaving: a stale break decision cannot delete a successor's lock", () => {
	const { registry, rootB } = setup();
	const deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
	const lock = plantLock(registry, JSON.stringify({ pid: deadPid, nonce: "gone" }));
	tryBreakLock(lock);
	expect(existsSync(lock)).toBe(false);
	plantLock(registry, JSON.stringify({ pid: process.pid, nonce: "successor" }));
	tryBreakLock(lock);
	expect(readFileSync(join(lock, "owner"), "utf8")).toContain('"successor"');
	expect(() => claimPortBlock(rootB, 1, registry, 50)).toThrow(/held by live pid/);
});

test("a garbled lock (unreadable owner) is broken only once it is old", () => {
	const { registry, rootA } = setup();
	const lock = plantLock(registry, "not json at all");
	expect(() => claimPortBlock(rootA, 1, registry, 50)).toThrow(/unreadable owner/);
	const old = (Date.now() - 60_000) / 1000;
	utimesSync(lock, old, old);
	expect(claimPortBlock(rootA, 1, registry)).toBe(base(1));
});
