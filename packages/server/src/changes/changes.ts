import { randomBytes, randomUUID } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
	ChangeReceipt,
	GitDiffScope,
	LineSpan,
	RevertTarget,
	Workspace,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { classifyBytes, decodeText, hashBytes, resolveWorktreeFile } from "../fs";
import { readBlobBytesAtAsync, resolveDiffRange } from "../git";
import { loadWorkspaces } from "../persistence";
import { trashFile } from "../trash";
import { revertedText, spanFits, splitLines } from "./textSplice";

export interface RevertChangeParams {
	workspaceId: string;
	path: string;
	scope: GitDiffScope;
	target: RevertTarget;
	expect: { originalHash: string | null; modifiedHash: string | null };
}

export interface UndoChangeParams {
	workspaceId: string;
	receiptId: string;
	expect: { modifiedHash: string | null };
}

const RECEIPT_RING = 20;
const BYTES = new TextEncoder();
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32(value: bigint, length: number): string {
	let encoded = "";
	for (let index = 0; index < length; index++) {
		encoded = (ULID_ALPHABET[Number(value & 31n)] ?? "0") + encoded;
		value >>= 5n;
	}
	return encoded;
}

function receiptId(): string {
	let random = 0n;
	for (const byte of randomBytes(10)) random = (random << 8n) | BigInt(byte);
	return `${base32(BigInt(Date.now()), 10)}${base32(random, 16)}`;
}

interface ReceiptRecord {
	receipt: ChangeReceipt;
	before: Uint8Array | null;
}

const rings = new Map<string, ReceiptRecord[]>();

function workspace(workspaceId: string): Workspace {
	const ws = loadWorkspaces().find((candidate) => candidate.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	return ws;
}

function worktreeBytes(abs: string): Uint8Array | null {
	try {
		return readFileSync(abs);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		if (code === "ENOENT") return null;
		throw error;
	}
}

function hashOf(bytes: Uint8Array | null): string | null {
	return bytes === null ? null : hashBytes(bytes);
}

function identity(bytes: Uint8Array | null): { hash: string | null; byteLength: number | null } {
	return bytes === null
		? { hash: null, byteLength: null }
		: { hash: hashBytes(bytes), byteLength: bytes.byteLength };
}

function writeAtomic(abs: string, bytes: Uint8Array): void {
	const dir = dirname(abs);
	mkdirSync(dir, { recursive: true });
	let mode: number | undefined;
	try {
		mode = statSync(abs).mode;
	} catch {}
	const tmp = join(dir, `.thinkrail-revert-${process.pid}-${randomUUID().slice(0, 8)}.tmp`);
	try {
		writeFileSync(tmp, bytes);
		if (mode !== undefined) chmodSync(tmp, mode);
		renameSync(tmp, abs);
	} catch (error) {
		rmSync(tmp, { force: true });
		throw error;
	}
}

function claimForTrash(abs: string): string {
	const claimed = join(dirname(abs), `.thinkrail-revert-${receiptId()}`);
	renameSync(abs, claimed);
	return claimed;
}

async function trashClaim(claimed: string, abs: string): Promise<void> {
	try {
		await trashFile(claimed);
	} catch (error) {
		renameSync(claimed, abs);
		throw error;
	}
}

function record(change: {
	kind: ChangeReceipt["kind"];
	workspaceId: string;
	path: string;
	before: Uint8Array | null;
	after: Uint8Array | null;
	trashed?: string;
}): ChangeReceipt {
	const receipt: ChangeReceipt = {
		id: receiptId(),
		workspaceId: change.workspaceId,
		path: change.path,
		kind: change.kind,
		at: Date.now(),
		before: identity(change.before),
		after: identity(change.after),
		...(change.trashed === undefined ? {} : { trashed: change.trashed }),
	};
	const ring = rings.get(change.workspaceId) ?? [];
	ring.push({ receipt, before: change.before });
	while (ring.length > RECEIPT_RING) ring.shift();
	rings.set(change.workspaceId, ring);
	return receipt;
}

async function originalSide(params: RevertChangeParams): Promise<Uint8Array | null> {
	const ws = workspace(params.workspaceId);
	const range = await resolveDiffRange(ws, params.scope);
	if (range.modifiedRef !== null) {
		throw new CodedError(
			"SCOPE_IMMUTABLE",
			"This diff's modified side is a commit, not the worktree — there is nothing to revert.",
		);
	}
	if (range.originalRef !== null && range.resolvedOriginalOid === null) {
		throw new CodedError(
			"STALE_VIEW",
			"The original side of this diff no longer resolves — re-read it before reverting.",
		);
	}
	return range.resolvedOriginalOid
		? await readBlobBytesAtAsync(ws.worktreePath, range.resolvedOriginalOid, params.path)
		: null;
}

function assertSameView(
	params: RevertChangeParams,
	original: Uint8Array | null,
	modified: Uint8Array | null,
): void {
	const stale =
		hashOf(original) !== params.expect.originalHash
			? "original"
			: hashOf(modified) !== params.expect.modifiedHash
				? "modified"
				: null;
	if (stale !== null) {
		throw new CodedError(
			"STALE_VIEW",
			`The ${stale} side of ${params.path} changed since this diff was rendered — re-read it before reverting.`,
		);
	}
}

function revertedRange(
	path: string,
	original: Uint8Array | null,
	modified: Uint8Array | null,
	target: { original: LineSpan; modified: LineSpan },
): Uint8Array {
	if (modified === null) {
		throw new CodedError(
			"RANGE_INVALID",
			`${path} is absent from the worktree — revert the whole file instead of a range.`,
		);
	}
	if (!classifyBytes(modified).text || (original !== null && !classifyBytes(original).text)) {
		throw new CodedError(
			"RANGE_INVALID",
			`${path} is not text — only a whole-file revert applies.`,
		);
	}
	const originalLines = original === null ? [] : splitLines(decodeText(original));
	const modifiedLines = splitLines(decodeText(modified));
	if (!spanFits(target.original, originalLines.length)) {
		throw new CodedError(
			"RANGE_INVALID",
			`Lines ${target.original.start}+${target.original.count} lie outside the original side of ${path} (${originalLines.length} line(s)).`,
		);
	}
	if (!spanFits(target.modified, modifiedLines.length)) {
		throw new CodedError(
			"RANGE_INVALID",
			`Lines ${target.modified.start}+${target.modified.count} lie outside the worktree side of ${path} (${modifiedLines.length} line(s)).`,
		);
	}
	return BYTES.encode(revertedText(originalLines, modifiedLines, target));
}

export async function revertChange(params: RevertChangeParams): Promise<ChangeReceipt> {
	const original = await originalSide(params);
	const abs = resolveWorktreeFile(params.workspaceId, params.path);
	const modified = worktreeBytes(abs);
	assertSameView(params, original, modified);
	const change = {
		kind: "revert" as const,
		workspaceId: params.workspaceId,
		path: params.path,
	};

	if (params.target.kind === "range") {
		const next = revertedRange(params.path, original, modified, params.target);
		writeAtomic(abs, next);
		return record({ ...change, before: modified, after: next });
	}
	if (params.target.kind !== "file") {
		throw new CodedError("RANGE_INVALID", `Unknown revert target for ${params.path}.`);
	}
	if (original === null) {
		if (modified === null) {
			throw new CodedError(
				"RANGE_INVALID",
				`There is no change to revert for ${params.path} in this scope.`,
			);
		}
		const claimed = claimForTrash(abs);
		await trashClaim(claimed, abs);
		return record({ ...change, before: modified, after: null, trashed: claimed });
	}
	writeAtomic(abs, original);
	return record({ ...change, before: modified, after: original });
}

export async function undoChange(params: UndoChangeParams): Promise<ChangeReceipt> {
	const ring = rings.get(params.workspaceId) ?? [];
	const index = ring.findIndex((held) => held.receipt.id === params.receiptId);
	const held = index === -1 ? undefined : ring[index];
	if (held === undefined) {
		throw new CodedError(
			"RECEIPT_UNKNOWN",
			`This change can no longer be undone (receipt ${params.receiptId} is not held by the host).`,
		);
	}
	const abs = resolveWorktreeFile(params.workspaceId, held.receipt.path);
	const current = worktreeBytes(abs);
	if (hashOf(current) !== params.expect.modifiedHash) {
		throw new CodedError(
			"STALE_VIEW",
			`${held.receipt.path} changed since the change was applied — nothing was undone.`,
		);
	}
	let trashed: string | undefined;
	if (held.before === null) {
		if (current !== null) {
			const claimed = claimForTrash(abs);
			await trashClaim(claimed, abs);
			trashed = claimed;
		}
	} else {
		writeAtomic(abs, held.before);
	}
	ring.splice(index, 1);
	return record({
		kind: "undo",
		workspaceId: params.workspaceId,
		path: held.receipt.path,
		before: current,
		after: held.before,
		...(trashed === undefined ? {} : { trashed }),
	});
}
