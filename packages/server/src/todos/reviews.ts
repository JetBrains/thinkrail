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

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
	/** The item's commit shas the user had in front of them when they acted (empty for path-list items). */
	reviewedShas: string[];
	/** The user's fix request, kept while `changes_requested`. */
	feedback?: string;
	/** ISO timestamp of the review action. */
	at: string;
}

interface ReviewsFile {
	version: 1;
	items: Record<string, TodoReviewRecord>;
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
		typeof o.at === "string"
	);
}

/** Read a session's review records; a missing or corrupt file reads as none (never throws). */
export function readReviewRecords(
	root: string,
	sessionId: string,
): Record<string, TodoReviewRecord> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(reviewsPath(root, sessionId), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return {};
		const items = (parsed as Record<string, unknown>).items;
		if (typeof items !== "object" || items === null) return {};
		const out: Record<string, TodoReviewRecord> = {};
		for (const [id, value] of Object.entries(items)) {
			if (isRecord(value)) out[id] = value;
		}
		return out;
	} catch {
		return {};
	}
}

/** Write a session's review records atomically; an empty map removes the sidecar. */
export function writeReviewRecords(
	root: string,
	sessionId: string,
	items: Record<string, TodoReviewRecord>,
): void {
	const path = reviewsPath(root, sessionId);
	if (Object.keys(items).length === 0) {
		rmSync(path, { force: true });
		return;
	}
	const file: ReviewsFile = { version: 1, items };
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

/** Store one item's review record (read-modify-write). Returns the record it replaced, if any. */
export function putReviewRecord(
	root: string,
	sessionId: string,
	id: string,
	record: TodoReviewRecord,
): TodoReviewRecord | undefined {
	const items = readReviewRecords(root, sessionId);
	const previous = items[id];
	items[id] = record;
	writeReviewRecords(root, sessionId, items);
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
	const items = readReviewRecords(root, sessionId);
	if (previous) items[id] = previous;
	else if (items[id] === undefined) return;
	else delete items[id];
	writeReviewRecords(root, sessionId, items);
}

/** Remove a session's whole review sidecar — the chat is being deleted. Best-effort, idempotent. */
export function removeSessionReviews(root: string, sessionId: string): void {
	try {
		rmSync(reviewsPath(root, sessionId), { force: true });
	} catch {
		// best-effort — never fail the caller's delete
	}
}
