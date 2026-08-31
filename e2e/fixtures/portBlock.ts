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
import { removeTree } from "@thinkrail/shared/removeTree";

export const PORT_BLOCK_BASE = 25000;
export const PORT_BLOCK_STRIDE = 10;
export const PORT_BLOCK_SLOTS = 500;

export const PORT_BLOCK_REGISTRY = join(tmpdir(), "thinkrail-e2e-port-blocks");

export interface PortBlockOwner {
	key: string;
	livenessPath: string;
}

type PortBlockOwnerInput = string | PortBlockOwner;

const STALE_LOCK_MS = 10_000;

function removeLockTree(path: string): void {
	removeTree(path, { delayMs: 10 });
}

function slotBase(slot: number): number {
	return PORT_BLOCK_BASE + slot * PORT_BLOCK_STRIDE;
}

function normalizeOwner(owner: PortBlockOwnerInput): PortBlockOwner {
	return typeof owner === "string" ? { key: owner, livenessPath: owner } : owner;
}

function readClaim(path: string): PortBlockOwner | undefined {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return undefined;
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
	} catch {}
	return { key: raw, livenessPath: raw };
}

function writeClaim(path: string, owner: PortBlockOwner): void {
	writeFileSync(path, owner.key === owner.livenessPath ? owner.key : JSON.stringify(owner));
}

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
		return undefined;
	} catch {
		return undefined;
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = error instanceof Error && "code" in error ? error.code : undefined;
		return code === "EPERM";
	}
}

function removeIfAged(path: string): boolean {
	let ageMs = Number.NaN;
	try {
		ageMs = Date.now() - statSync(path).mtimeMs;
	} catch {
		return false;
	}
	if (ageMs > STALE_LOCK_MS) {
		removeLockTree(path);
		return true;
	}
	return false;
}

export function tryBreakLock(lockPath: string): void {
	const tokenPath = `${lockPath}.break`;
	try {
		mkdirSync(tokenPath);
	} catch {
		return;
	}
	try {
		const owner = readLockOwner(lockPath);
		if (owner !== undefined) {
			if (!pidAlive(owner.pid)) removeLockTree(lockPath);
			return;
		}
		removeIfAged(lockPath);
	} finally {
		removeLockTree(tokenPath);
	}
}

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
		removeLockTree(prepPath);
		throw error;
	}
}

function releaseRegistryLock(lockPath: string, nonce: string): void {
	if (readLockOwner(lockPath)?.nonce === nonce) {
		removeLockTree(lockPath);
	}
}

function claimedSlots(registryDir: string): number[] {
	return readdirSync(registryDir)
		.filter((name) => /^\d+$/.test(name))
		.map(Number)
		.sort((a, b) => a - b);
}

function claimSlotOnce(
	owner: PortBlockOwner,
	preferredSlot: number,
	registryDir: string,
	lockTimeoutMs: number,
): number {
	const lock = acquireRegistryLock(registryDir, lockTimeoutMs);
	try {
		const [mine, ...duplicates] = claimedSlots(registryDir).filter(
			(slot) => readClaim(join(registryDir, String(slot)))?.key === owner.key,
		);
		if (mine !== undefined) {
			for (const extra of duplicates) rmSync(join(registryDir, String(extra)), { force: true });
			return mine;
		}

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
