// The persisted per-item REVIEW records behind the TODO review workflow (SPEC §Review workflow): the
// user's review decision on a reviewable item (one that carries a host change set) plus the watermark of
// what they had seen when they decided. A host-owned sidecar next to the todos JSON —
// `.thinkrail/context/todos/<sessionId>.reviews.json` — deliberately NOT the agent-writable plan file:
// a `todo_write` re-plan or any agent edit must never flip a review decision. Absence of a record reads
// as `unreviewed` (derived, never stored). Read-modify-write like the store; robust by construction
// (missing/corrupt file → no records, atomic writes). Lives under `WORKSPACE_INTERNAL_DIR`, so it is
// itself filtered out of change sets. Orphan records (item removed/replanned away) are inert — they are
// keyed by todo id and nothing ever reads a vanished item's key — but `todo.remove` and session delete
// still prune, matching the baselines lifecycle.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";

const REVIEWS_SUFFIX = ".reviews.json";

/**
 * One reviewable item's stored review decision. `reviewedShas` is the watermark: the item's commit shas
 * at the moment the user acted — a commit artifact appended later is the *unreviewed delta* ("changed
 * since review"). `unreviewed` is never stored; it is the absence of a record.
 */
export interface TodoReviewRecord {
	state: "reviewed" | "changes_requested";
	/** The item's commit shas the reviewer had in front of them when they acted (empty for path-list items). */
	reviewedShas: string[];
	/** The fix request (the user's text, or the reviewer agent's verdict note), kept while `changes_requested`. */
	feedback?: string;
	/** ISO timestamp of the review action. */
	at: string;
	/** Who settled a `reviewed` state — the human's Approve (default, absent) or the reviewer agent. */
	reviewedBy?: "agent";
	/** Auto fix→re-review cycles already spent on this item (cap: 1 auto cycle, then the human decides). */
	autoCycles?: number;
}

/** Sidecar meta beside the records: the plan's pinned reviewer chat + in-flight review marks. */
export interface TodoReviewMeta {
	/** The plan's dedicated reviewer chat (created on first Start review, one per worker session). */
	reviewerSessionId?: string;
	/** Items whose agent review is in flight (verdict pending) — the UI's `reviewing` spinner. */
	pending: Record<string, { at: string }>;
}

interface ReviewsFile {
	version: 1;
	items: Record<string, TodoReviewRecord>;
	reviewerSessionId?: string;
	pending?: Record<string, { at: string }>;
}

function reviewsPath(root: string, sessionId: string): string {
	// The session id was validated as a safe path segment by `TodoStore` before any record exists.
	return join(root, WORKSPACE_TODOS_DIR, `${sessionId}${REVIEWS_SUFFIX}`);
}

function isRecord(raw: unknown): raw is TodoReviewRecord {
	if (typeof raw !== "object" || raw === null) return false;
	const o = raw as Record<string, unknown>;
	return (
		(o.state === "reviewed" || o.state === "changes_requested") &&
		Array.isArray(o.reviewedShas) &&
		o.reviewedShas.every((s) => typeof s === "string") &&
		(o.feedback === undefined || typeof o.feedback === "string") &&
		(o.reviewedBy === undefined || o.reviewedBy === "agent") &&
		(o.autoCycles === undefined || typeof o.autoCycles === "number") &&
		typeof o.at === "string"
	);
}

/** Read the whole sidecar (records + meta); missing/corrupt reads as empty (never throws). */
function readFile(root: string, sessionId: string): ReviewsFile {
	try {
		const parsed: unknown = JSON.parse(readFileSync(reviewsPath(root, sessionId), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return { version: 1, items: {} };
		const o = parsed as Record<string, unknown>;
		const items: Record<string, TodoReviewRecord> = {};
		if (typeof o.items === "object" && o.items !== null) {
			for (const [id, value] of Object.entries(o.items)) {
				if (isRecord(value)) items[id] = value;
			}
		}
		const file: ReviewsFile = { version: 1, items };
		if (typeof o.reviewerSessionId === "string" && o.reviewerSessionId)
			file.reviewerSessionId = o.reviewerSessionId;
		if (typeof o.pending === "object" && o.pending !== null) {
			const pending: ReviewsFile["pending"] = {};
			for (const [id, value] of Object.entries(o.pending)) {
				const at = (value as Record<string, unknown> | null)?.at;
				if (typeof at === "string") pending[id] = { at };
			}
			if (Object.keys(pending).length > 0) file.pending = pending;
		}
		return file;
	} catch {
		return { version: 1, items: {} };
	}
}

/** Write the whole sidecar atomically; a file with no records AND no meta is removed. */
function writeFile(root: string, sessionId: string, file: ReviewsFile): void {
	const path = reviewsPath(root, sessionId);
	const empty =
		Object.keys(file.items).length === 0 &&
		!file.reviewerSessionId &&
		Object.keys(file.pending ?? {}).length === 0;
	if (empty) {
		rmSync(path, { force: true });
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

/** The sidecar's meta half: the pinned reviewer chat + the in-flight review marks. */
export function readReviewMeta(root: string, sessionId: string): TodoReviewMeta {
	const file = readFile(root, sessionId);
	const meta: TodoReviewMeta = { pending: file.pending ?? {} };
	if (file.reviewerSessionId) meta.reviewerSessionId = file.reviewerSessionId;
	return meta;
}

/** Pin the plan's reviewer chat (first Start review creates it). */
export function setReviewerSession(root: string, sessionId: string, reviewerId: string): void {
	const file = readFile(root, sessionId);
	file.reviewerSessionId = reviewerId;
	writeFile(root, sessionId, file);
}

/** Mark / clear an item's in-flight agent review (the `reviewing` decoration). Read-modify-write. */
export function markReviewPending(root: string, sessionId: string, id: string): void {
	const file = readFile(root, sessionId);
	file.pending = { ...(file.pending ?? {}), [id]: { at: new Date().toISOString() } };
	writeFile(root, sessionId, file);
}

export function clearReviewPending(root: string, sessionId: string, id: string): void {
	const file = readFile(root, sessionId);
	if (!file.pending?.[id]) return;
	delete file.pending[id];
	writeFile(root, sessionId, file);
}

/** Read a session's review records; a missing or corrupt file reads as none (never throws). */
export function readReviewRecords(
	root: string,
	sessionId: string,
): Record<string, TodoReviewRecord> {
	return readFile(root, sessionId).items;
}

/** Store one item's review record (read-modify-write). Returns the record it replaced, if any. */
export function putReviewRecord(
	root: string,
	sessionId: string,
	id: string,
	record: TodoReviewRecord,
): TodoReviewRecord | undefined {
	const file = readFile(root, sessionId);
	const previous = file.items[id];
	file.items[id] = record;
	writeFile(root, sessionId, file);
	return previous;
}

/**
 * Drop one item's record (or restore `previous` over it — the ask-to-fix send-failure rollback).
 * A missing sidecar or absent id is a no-op.
 */
export function dropReviewRecord(
	root: string,
	sessionId: string,
	id: string,
	previous?: TodoReviewRecord,
): void {
	const file = readFile(root, sessionId);
	if (previous) file.items[id] = previous;
	else if (file.items[id] === undefined) return;
	else delete file.items[id];
	writeFile(root, sessionId, file);
}

/**
 * The worker session whose sidecar pins `reviewerId` as its reviewer chat — the reverse lookup the
 * `review_verdict` seam needs (the tool only knows the calling reviewer session). Enumerates the
 * worktree's `.reviews.json` sidecars (same pattern as the baselines' `otherOwners`); missing dir or
 * unreadable entries read as "none" — never throws.
 */
export function findWorkerSessionByReviewer(root: string, reviewerId: string): string | undefined {
	try {
		return readdirSync(join(root, WORKSPACE_TODOS_DIR))
			.filter((n) => n.endsWith(REVIEWS_SUFFIX))
			.map((n) => n.slice(0, -REVIEWS_SUFFIX.length))
			.find((owner) => readFile(root, owner).reviewerSessionId === reviewerId);
	} catch {
		return undefined;
	}
}

/** Remove a session's whole review sidecar — the chat is being deleted. Best-effort, idempotent. */
export function removeSessionReviews(root: string, sessionId: string): void {
	try {
		rmSync(reviewsPath(root, sessionId), { force: true });
	} catch {
		// best-effort — never fail the caller's delete
	}
}
