import { randomBytes, randomUUID } from "node:crypto";
import {
	chmodSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
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
import { readBlobBytesAtAsync, readPathModeAtAsync, resolveDiffRange } from "../git";
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

interface FileState {
	bytes: Uint8Array | null;
	mode: number | null;
}

const RECEIPT_RING = 20;
const RECEIPT_RING_BYTES = 64 * 1024 * 1024;
const BYTES = new TextEncoder();
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GIT_MODE_TYPE = 0o170000;
const GIT_MODE_FILE = 0o100000;
const GIT_MODE_SYMLINK = 0o120000;

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
	before: FileState;
}

const rings = new Map<string, ReceiptRecord[]>();

export function retainReceipts<T extends { before: { bytes: Uint8Array | null } }>(
	ring: readonly T[],
	limits: { count: number; bytes: number } = { count: RECEIPT_RING, bytes: RECEIPT_RING_BYTES },
): T[] {
	const retained: T[] = [];
	let bytes = 0;
	for (let index = ring.length - 1; index >= 0; index--) {
		const held = ring[index];
		if (held === undefined) continue;
		const size = held.before.bytes?.byteLength ?? 0;
		if (retained.length > 0 && (retained.length >= limits.count || bytes + size > limits.bytes))
			break;
		retained.unshift(held);
		bytes += size;
	}
	return retained;
}

export function forgetWorkspaceChanges(workspaceId: string): void {
	rings.delete(workspaceId);
}

function workspace(workspaceId: string): Workspace {
	const ws = loadWorkspaces().find((candidate) => candidate.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	return ws;
}

function unsupported(path: string, reason: string): never {
	throw new CodedError("UNSUPPORTED_CHANGE", `${path} ${reason}`);
}

function worktreeState(abs: string, path: string): FileState {
	let stat: ReturnType<typeof lstatSync>;
	try {
		stat = lstatSync(abs);
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
		if (code === "ENOENT") return { bytes: null, mode: null };
		throw error;
	}
	if (stat.isSymbolicLink())
		unsupported(path, "is a symbolic link, which change mutations do not support.");
	return { bytes: readFileSync(abs), mode: stat.mode & 0o777 };
}

function hashOf(state: FileState): string | null {
	return state.bytes === null ? null : hashBytes(state.bytes);
}

function identity(state: FileState): ChangeReceipt["before"] {
	return state.bytes === null
		? { hash: null, byteLength: null, mode: null }
		: { hash: hashBytes(state.bytes), byteLength: state.bytes.byteLength, mode: state.mode };
}

function writeAtomic(abs: string, state: FileState): void {
	if (state.bytes === null || state.mode === null)
		throw new Error("Cannot write an absent file state");
	const dir = dirname(abs);
	mkdirSync(dir, { recursive: true });
	const tmp = join(dir, `.thinkrail-revert-${process.pid}-${randomUUID().slice(0, 8)}.tmp`);
	try {
		writeFileSync(tmp, state.bytes);
		chmodSync(tmp, state.mode);
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

function recoveryError(error: unknown, recovery: string): Error {
	const message = error instanceof Error ? error.message : String(error);
	return new Error(`${message} The claimed file was preserved at ${recovery}.`, { cause: error });
}

async function trashClaim(claimed: string, abs: string): Promise<void> {
	try {
		await trashFile(claimed);
	} catch (error) {
		try {
			linkSync(claimed, abs);
		} catch {
			const recovery = join(dirname(abs), `.thinkrail-recovery-${receiptId()}`);
			renameSync(claimed, recovery);
			throw recoveryError(error, recovery);
		}
		rmSync(claimed, { force: true });
		throw error;
	}
}

function record(change: {
	kind: ChangeReceipt["kind"];
	workspaceId: string;
	path: string;
	before: FileState;
	after: FileState;
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
	rings.set(change.workspaceId, retainReceipts([...ring, { receipt, before: change.before }]));
	return receipt;
}

function permissionsForGitMode(path: string, mode: number | null): number | null {
	if (mode === null) return null;
	if ((mode & GIT_MODE_TYPE) === GIT_MODE_SYMLINK) {
		unsupported(path, "is a symbolic link in Git, which change mutations do not support.");
	}
	if ((mode & GIT_MODE_TYPE) !== GIT_MODE_FILE) {
		unsupported(path, "is not a regular Git file, which change mutations do not support.");
	}
	return mode & 0o111 ? 0o755 : 0o644;
}

async function originalSide(params: RevertChangeParams): Promise<FileState> {
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
	if (!range.resolvedOriginalOid) return { bytes: null, mode: null };
	const [bytes, gitMode] = await Promise.all([
		readBlobBytesAtAsync(ws.worktreePath, range.resolvedOriginalOid, params.path),
		readPathModeAtAsync(ws.worktreePath, range.resolvedOriginalOid, params.path),
	]);
	if ((bytes === null) !== (gitMode === null)) {
		throw new Error(`Could not read a consistent original side for ${params.path}`);
	}
	return { bytes, mode: permissionsForGitMode(params.path, gitMode) };
}

function assertSameView(
	params: RevertChangeParams,
	original: FileState,
	modified: FileState,
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

function assertNotModeOnly(path: string, original: FileState, modified: FileState): void {
	if (
		original.bytes !== null &&
		modified.bytes !== null &&
		hashOf(original) === hashOf(modified) &&
		original.mode !== modified.mode
	) {
		unsupported(path, "has only a mode change, which change mutations do not support.");
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
	const abs = resolveWorktreeFile(params.workspaceId, params.path, { followLeaf: false });
	const modified = worktreeState(abs, params.path);
	assertSameView(params, original, modified);
	assertNotModeOnly(params.path, original, modified);
	const change = {
		kind: "revert" as const,
		workspaceId: params.workspaceId,
		path: params.path,
	};

	if (params.target.kind === "range") {
		const bytes = revertedRange(params.path, original.bytes, modified.bytes, params.target);
		const next = { bytes, mode: modified.mode };
		writeAtomic(abs, next);
		return record({ ...change, before: modified, after: next });
	}
	if (params.target.kind !== "file") {
		throw new CodedError("RANGE_INVALID", `Unknown revert target for ${params.path}.`);
	}
	if (original.bytes === null) {
		if (modified.bytes === null) {
			throw new CodedError(
				"RANGE_INVALID",
				`There is no change to revert for ${params.path} in this scope.`,
			);
		}
		const claimed = claimForTrash(abs);
		await trashClaim(claimed, abs);
		return record({
			...change,
			before: modified,
			after: { bytes: null, mode: null },
			trashed: claimed,
		});
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
	const abs = resolveWorktreeFile(params.workspaceId, held.receipt.path, { followLeaf: false });
	const current = worktreeState(abs, held.receipt.path);
	if (hashOf(current) !== params.expect.modifiedHash) {
		throw new CodedError(
			"STALE_VIEW",
			`${held.receipt.path} changed since the change was applied — nothing was undone.`,
		);
	}
	let trashed: string | undefined;
	if (held.before.bytes === null) {
		if (current.bytes !== null) {
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
