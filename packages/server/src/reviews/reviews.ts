// The per-workspace review store + lifecycle (see SPEC.md). One open review per workspace is persisted as
// `reviews/<workspaceId>.json`; Clear preserves non-draft records under `reviews/archive/…`. Every active
// mutation — UI edits, agent resolves, a
// re-anchor that changed states — persists then emits ONE full `review.changed` snapshot through the
// host-installed publisher, so all clients (the initiator too) converge on the push, never optimism.

import { randomUUID } from "node:crypto";
import {
	type Dirent,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
	GitDiffScope,
	ReviewAnchor,
	ReviewChangedPayload,
	ReviewComment,
	ReviewCommentKind,
	ReviewCommentStatus,
	ReviewSnapshot,
} from "@thinkrail/contracts";
import { diffBaseRef, readBlobAt, resolveCommitOid, resolveDiffRange } from "../git";
import { dataDir } from "../persistence";
import { getWorkspace } from "../workspaces";
import { buildTextQuote, hashContent, lineRangeOf, reanchor, textQuoteOf } from "./anchoring";
import { renderPackage } from "./packageRender";

let publish: (payload: ReviewChangedPayload) => void = () => {};
export function setReviewPublisher(fn: (payload: ReviewChangedPayload) => void): void {
	publish = fn;
}

function reviewsDir(): string {
	return join(dataDir(), "reviews");
}

const SAFE_ID = /^[\w-]+$/;

function assertSafeId(id: string, kind: "workspace" | "review"): void {
	if (!SAFE_ID.test(id)) throw new Error(`Invalid ${kind} id: ${id}`);
}

function reviewFile(workspaceId: string): string {
	// The id becomes a FILENAME, so it must never carry path segments: real workspace ids are UUIDs,
	// and a wire-supplied `../config`-style string would aim every read/write/unlink in this module
	// outside the reviews dir (e.g. at the data dir's own config). Refusing here covers ALL file
	// touches at once — defense in depth behind the handlers' own lookups.
	assertSafeId(workspaceId, "workspace");
	return join(reviewsDir(), `${workspaceId}.json`);
}

function archiveRoot(): string {
	return join(reviewsDir(), "archive");
}

function archiveWorkspaceDir(workspaceId: string): string {
	assertSafeId(workspaceId, "workspace");
	return join(archiveRoot(), workspaceId);
}

function archiveReviewFile(workspaceId: string, reviewId: string): string {
	assertSafeId(reviewId, "review");
	return join(archiveWorkspaceDir(workspaceId), `${reviewId}.json`);
}

/**
 * The workspace's review file, or `null` when there simply ISN'T one.
 *
 * **Only `ENOENT` is "no review".** Every other read failure — a permission/IO error, a file that
 * doesn't parse — **throws**, because the only caller that acts on `null` is `ensureSnapshot`, and its
 * action is to write a fresh empty review over the file: reporting "damaged" as "absent" would silently
 * discard every comment the review held. Throwing surfaces it to the client (`review.get` fails, the
 * panel says so) and leaves the file on disk to be recovered by hand.
 */
function readSnapshot(file: string): ReviewSnapshot | null {
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
	try {
		return JSON.parse(raw) as ReviewSnapshot;
	} catch {
		throw new Error(`Review file ${file} is damaged and was left in place — repair or remove it.`);
	}
}

function load(workspaceId: string): ReviewSnapshot | null {
	return readSnapshot(reviewFile(workspaceId));
}

/**
 * Persist a snapshot **atomically**: write a sibling temp file, then rename it over the target (a rename
 * within one directory is atomic). A plain in-place write can be interrupted — by a host crash, a full
 * disk, a machine losing power — leaving a truncated file that is no longer a review, and by contract
 * {@link load} then refuses to read it rather than replacing it. The temp file is named per-process so
 * two hosts sharing a data dir can't tread on each other's write, and is removed on failure.
 */
function saveFile(file: string, snapshot: ReviewSnapshot): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	try {
		writeFileSync(tmp, `${JSON.stringify(snapshot, null, "\t")}\n`);
		renameSync(tmp, file);
	} catch (err) {
		rmSync(tmp, { force: true });
		throw err;
	}
}

function save(workspaceId: string, snapshot: ReviewSnapshot): void {
	saveFile(reviewFile(workspaceId), snapshot);
}

function saveArchive(workspaceId: string, snapshot: ReviewSnapshot): void {
	saveFile(archiveReviewFile(workspaceId, snapshot.review.id), snapshot);
}

function archivedReviewFiles(): string[] {
	let workspaceDirs: Dirent[];
	try {
		workspaceDirs = readdirSync(archiveRoot(), { withFileTypes: true });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	const files: string[] = [];
	for (const workspace of workspaceDirs) {
		if (!workspace.isDirectory() || !SAFE_ID.test(workspace.name)) continue;
		const dir = join(archiveRoot(), workspace.name);
		try {
			for (const review of readdirSync(dir, { withFileTypes: true })) {
				if (review.isFile() && review.name.endsWith(".json")) files.push(join(dir, review.name));
			}
		} catch (err) {
			console.warn(
				`review archive ${workspace.name}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
	return files;
}

function persistAndPublish(workspaceId: string, snapshot: ReviewSnapshot): void {
	save(workspaceId, snapshot);
	publish({ workspaceId, ...snapshot });
}

/** A worktree file's content, path-contained; `null` when unreadable/absent (deleted files re-anchor
 * to `outdated`, not to a throw). */
function readWorktreeFile(worktreePath: string, path: string): string | null {
	const abs = resolve(worktreePath, path);
	const rel = relative(worktreePath, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes the worktree");
	try {
		return readFileSync(abs, "utf8");
	} catch {
		return null;
	}
}

/** Build a fresh open review against the workspace's current branch range; persistence is the caller's. */
function freshSnapshot(workspaceId: string): ReviewSnapshot {
	const ws = getWorkspace(workspaceId);
	// The review is made against the ORIGINAL SIDE OF THE DIFF the user is reviewing, pinned to a full
	// oid. That is the branch range's `originalRef` — the **fork point** (`merge-base` of the diff target
	// and `HEAD`) — not the target's tip: once the target advances past a diverged workspace, the tip
	// carries upstream commits the review never displayed. Pinned because the target is re-pointable
	// and its branch can move, while what this review *is* must not. Deliberately the BRANCH range,
	// whatever scope the Changes panel happens to show: a scope switch must not redefine the review (a
	// comment made in another scope still quotes its own `anchor.baseRef`). Degrades to the raw ref if
	// it wouldn't resolve — the base's consumers cope with a raw ref, and losing the whole review
	// surface over an unreadable base would cost far more than it saves.
	const ref = resolveDiffRange(ws).originalRef ?? diffBaseRef(ws);
	const base = resolveCommitOid(ws.worktreePath, ref);
	return {
		review: {
			id: `rev_${randomUUID().slice(0, 8)}`,
			workspaceId,
			status: "open",
			baseSha: base ?? ref,
			createdAt: Date.now(),
		},
		comments: [],
	};
}

function archiveRecords(workspaceId: string, snapshot: ReviewSnapshot): void {
	const archived: ReviewSnapshot = {
		review: {
			...snapshot.review,
			status: "closed",
			closedAt: snapshot.review.closedAt ?? Date.now(),
		},
		comments: snapshot.comments.filter((comment) => comment.status !== "draft"),
	};
	if (archived.comments.length > 0) saveArchive(workspaceId, archived);
}

/** The open review for a workspace, created lazily. Old closed snapshots are archived on first touch. */
function ensureSnapshot(workspaceId: string): ReviewSnapshot {
	const existing = load(workspaceId);
	if (existing?.review.status === "open") return existing;
	const snapshot = freshSnapshot(workspaceId);
	if (existing) archiveRecords(workspaceId, existing);
	save(workspaceId, snapshot);
	return snapshot;
}

/** Re-anchor every worktree-side comment in place. Returns true when any anchor/state changed. */
function reanchorSnapshot(workspaceId: string, snapshot: ReviewSnapshot): boolean {
	const ws = getWorkspace(workspaceId);
	let changed = false;
	snapshot.comments = snapshot.comments.map((comment) => {
		const anchor = comment.anchor;
		// Review-level comments have nothing to anchor; base-side anchors are fixed for the review's life.
		if (!anchor || anchor.side === "base") return comment;
		const content = readWorktreeFile(ws.worktreePath, anchor.path);
		const result = reanchor(anchor, content);
		// `moved` is STICKY: a re-pin updates the anchor's contentHash, so the very next pass sees a hash
		// match and would silently downgrade it back to `anchored` — losing the "this drifted since
		// creation" fact the state exists to record. A fresh single match still upgrades outdated→moved.
		const state =
			result.state === "anchored" && comment.anchorState === "moved" ? "moved" : result.state;
		if (state === comment.anchorState && result.anchor === anchor) return comment;
		changed = true;
		return { ...comment, anchorState: state, anchor: result.anchor };
	});
	return changed;
}

/** The open review + comments, re-anchored against the current worktree (persisted + pushed if that
 * moved anything). The hydration read behind `review.get`. */
export function getReviewSnapshot(workspaceId: string): ReviewSnapshot {
	const snapshot = ensureSnapshot(workspaceId);
	if (reanchorSnapshot(workspaceId, snapshot)) persistAndPublish(workspaceId, snapshot);
	return snapshot;
}

/** Re-anchor on a worktree change (the host tees this off the watch publisher). Publishes only when
 * something actually moved; a workspace with no review file is a no-op. */
export function reanchorWorkspace(workspaceId: string): void {
	try {
		const snapshot = load(workspaceId);
		if (snapshot?.review.status !== "open" || snapshot.comments.length === 0) return;
		if (reanchorSnapshot(workspaceId, snapshot)) persistAndPublish(workspaceId, snapshot);
	} catch {
		// Nothing to re-anchor: an unknown workspace (mid-archive race) or a review file `load` refused
		// to read. Both are reported by the next `review.get`; a background fs tick has no one to throw to.
	}
}

export interface AddCommentInput {
	workspaceId: string;
	kind: ReviewCommentKind;
	anchor: ReviewAnchor | null;
	body: string;
	/** The diff a `side: "base"` anchor was captured in — what resolves its `baseRef` (default: branch). */
	scope?: GitDiffScope;
}

/**
 * Fill an anchor's content-derived fields from the side's OWN content: `contentHash` + a missing
 * `textQuote` (the exact selected lines plus context), so re-anchoring and the send package always have
 * both. Content-less (a file-level anchor with no range, or an unreadable file) → the anchor as given.
 */
function captureAnchor(anchor: ReviewAnchor, content: string): ReviewAnchor {
	const range = lineRangeOf(anchor);
	const selectors =
		range && !textQuoteOf(anchor)
			? [...anchor.selectors, buildTextQuote(content, range.startLine, range.endLine)]
			: anchor.selectors;
	return { ...anchor, contentHash: hashContent(content), selectors };
}

/**
 * Add a draft. The client supplies only the `lineRange` it selected; the host reads that side's content
 * and captures the rest (see {@link captureAnchor}) — for a **`base`** anchor from the blob the diff's
 * ORIGINAL editor is showing, resolved from the tab's `scope`, never from the worktree: the two sides'
 * line numbers name different content, so a base selection translated to worktree lines would attach the
 * remark to whatever happens to sit there. The resolved ref is stamped on the anchor (`baseRef`) so the
 * fragment stays readable for the review's life.
 */
export function addComment(input: AddCommentInput): ReviewComment {
	const body = input.body.trim();
	if (!body) throw new Error("A comment body is required.");
	if (input.kind !== "review" && !input.anchor?.path)
		throw new Error(`A ${input.kind} comment requires an anchor path.`);
	if (input.kind === "review" && input.anchor)
		throw new Error("A review-level comment carries no anchor.");
	const snapshot = ensureSnapshot(input.workspaceId);
	let anchor = input.anchor;
	if (anchor) {
		const ws = getWorkspace(input.workspaceId);
		if (anchor.side === "base") {
			const originalRef = resolveDiffRange(ws, input.scope).originalRef;
			if (!originalRef)
				throw new Error("This diff has no base side to comment on (nothing precedes the change).");
			// PIN IT. A scope's `originalRef` can be symbolic — `uncommitted` is the literal `HEAD`, a
			// `branch` scope degrades to the raw base ref when `merge-base` fails — and a base anchor's
			// whole premise is that the blob it quotes never moves. Stored as-is, the user's next commit
			// re-points `HEAD` and the package reads today's content at yesterday's line numbers: the agent
			// is shown a fragment the remark was never about.
			const baseRef = resolveCommitOid(ws.worktreePath, originalRef);
			if (!baseRef)
				throw new Error(`Can't pin the base side of this diff: ${originalRef} names no commit.`);
			const content = readBlobAt(ws.worktreePath, baseRef, anchor.path);
			if (content === null)
				throw new Error(`The base (${baseRef}) has no ${anchor.path} to comment on.`);
			// The scope rides along with the ref it resolved: it is the tab identity the Review panel
			// reopens this diff by, and only that surface renders the blob the remark quotes.
			anchor = captureAnchor(
				{ ...anchor, baseRef, ...(input.scope ? { scope: input.scope } : {}) },
				content,
			);
		} else {
			const content = readWorktreeFile(ws.worktreePath, anchor.path);
			if (content !== null) anchor = captureAnchor(anchor, content);
		}
	}
	const comment: ReviewComment = {
		id: `rc_${randomUUID().slice(0, 8)}`,
		reviewId: snapshot.review.id,
		kind: input.kind,
		anchor,
		body,
		status: "draft",
		anchorState: "anchored",
		createdAt: Date.now(),
	};
	snapshot.comments.push(comment);
	// A new remark re-opens a finished file: `doneFiles` says "we're done HERE", and a fresh comment is
	// the user saying otherwise.
	const key = reviewSessionKey(comment);
	if (snapshot.review.doneFiles?.includes(key))
		snapshot.review.doneFiles = snapshot.review.doneFiles.filter((p) => p !== key);
	persistAndPublish(input.workspaceId, snapshot);
	return comment;
}

/**
 * Mark one file's review finished (`path`; the empty string is the whole-change-set bucket, like
 * `reviewSessionKey`). Only a file with nothing unresolved can be done — the list keeps a
 * fully-resolved file visible until the user says "we're finished here", and this is that say.
 */
export function markFileDone(workspaceId: string, path: string): void {
	const snapshot = ensureSnapshot(workspaceId);
	const unresolved = snapshot.comments.some(
		(c) => reviewSessionKey(c) === path && (c.status === "draft" || c.status === "sent"),
	);
	if (unresolved) throw new Error("The file still has unresolved comments.");
	const done = snapshot.review.doneFiles ?? [];
	if (!done.includes(path)) snapshot.review.doneFiles = [...done, path];
	persistAndPublish(workspaceId, snapshot);
}

function mustFind(snapshot: ReviewSnapshot, id: string): ReviewComment {
	const comment = snapshot.comments.find((c) => c.id === id);
	if (!comment) throw new Error(`Unknown review comment: ${id}`);
	return comment;
}

/** Edit a draft's body, or flip status (the user's manual resolve/dismiss). Resolved is FINAL — like
 * delete and rollback, undoing a review outcome isn't offered: a fresh remark is a fresh comment. */
export function updateComment(input: {
	workspaceId: string;
	id: string;
	body?: string;
	status?: ReviewCommentStatus;
}): ReviewComment {
	const snapshot = ensureSnapshot(input.workspaceId);
	const comment = mustFind(snapshot, input.id);
	if (input.body !== undefined) {
		if (comment.status !== "draft") throw new Error("Only a draft comment's text can be edited.");
		if (!input.body.trim()) throw new Error("A comment body is required.");
		comment.body = input.body.trim();
	}
	if (input.status !== undefined && input.status !== comment.status) {
		// The wire may only land the terminal MANUAL outcomes. `draft`/`sent` are owned by the send path
		// (`markCommentsSent`/`rollbackSend`): a client that could flip a sent comment back to draft could
		// then rewrite or delete a remark whose id and text an agent chat already quotes.
		if (input.status !== "resolved" && input.status !== "dismissed")
			throw new Error(`A comment can only be resolved or dismissed — not set to ${input.status}.`);
		if (comment.status !== "draft" && comment.status !== "sent")
			throw new Error(`A ${comment.status} comment is final — add a new comment instead.`);
		comment.status = input.status;
		if (input.status === "resolved") {
			comment.resolvedBy = "user";
			comment.resolvedAt = Date.now();
		}
	}
	persistAndPublish(input.workspaceId, snapshot);
	return comment;
}

/** Delete a DRAFT — the one deletable state: an unsent remark is the user's own scratch. Anything
 * sent is a record (the chat already quotes its id) and stays. */
export function deleteComment(workspaceId: string, id: string): void {
	const snapshot = ensureSnapshot(workspaceId);
	const comment = mustFind(snapshot, id);
	if (comment.status !== "draft")
		throw new Error("Only a draft can be deleted — a sent comment is a record.");
	snapshot.comments = snapshot.comments.filter((c) => c.id !== id);
	persistAndPublish(workspaceId, snapshot);
}

/**
 * Clear a review as one shared-state mutation: refuse damaged state, archive every non-draft record before
 * replacing the active file, and publish only the fresh snapshot so every client empties together.
 */
export function clearReview(workspaceId: string): ReviewSnapshot {
	const existing = load(workspaceId);
	const fresh = freshSnapshot(workspaceId);
	// Archive first: a later active-write failure can leave a duplicate closed snapshot, never a lost
	// record. Retrying overwrites the same review-id path before writing a new fresh active snapshot.
	if (existing) archiveRecords(workspaceId, existing);
	persistAndPublish(workspaceId, fresh);
	return fresh;
}

/**
 * The draft comments a send would cover: the given ids (each must exist and be a draft) or, when
 * omitted, every draft. Re-anchors first so the package's line numbers are true at send time.
 */
export function sendableComments(workspaceId: string, commentIds?: string[]): ReviewComment[] {
	const snapshot = getReviewSnapshot(workspaceId);
	const drafts = snapshot.comments.filter((c) => c.status === "draft");
	if (!commentIds) {
		if (drafts.length === 0) throw new Error("No draft comments to send.");
		return drafts;
	}
	return commentIds.map((id) => {
		const comment = mustFind(snapshot, id);
		if (comment.status !== "draft") throw new Error(`Comment ${id} is not a draft.`);
		return comment;
	});
}

/** Render the structured context package for these comments (see `packageRender`). Each side reads its
 * own content: the worktree for worktree anchors, the anchor's captured `baseRef` blob for base ones. */
export function buildSendPackage(workspaceId: string, comments: ReviewComment[]): string {
	const ws = getWorkspace(workspaceId);
	const snapshot = ensureSnapshot(workspaceId);
	return renderPackage({
		review: snapshot.review,
		branch: ws.branch,
		baseBranch: diffBaseRef(ws),
		comments,
		readFile: (path) => readWorktreeFile(ws.worktreePath, path),
		readBase: (ref, path) => readBlobAt(ws.worktreePath, ref, path),
	});
}

/**
 * The `fileSessions` key a comment's chat is pinned under: its file, or {@link REVIEW_LEVEL_KEY} for an
 * anchorless (whole-change-set) remark. The bucket is pinned like any file, so a second overall remark
 * continues the same discussion instead of opening a chat of its own.
 */
export const REVIEW_LEVEL_KEY = "";
export function reviewSessionKey(comment: Pick<ReviewComment, "anchor">): string {
	return comment.anchor?.path ?? REVIEW_LEVEL_KEY;
}

/** Flip sent comments over: status, timestamps, the session link — and pin each comment's file (or the
 * review-level bucket) to the session in `fileSessions`, so every later send for it follows up into the
 * same chat. */
export function markCommentsSent(
	workspaceId: string,
	commentIds: string[],
	sessionId: string,
): void {
	const snapshot = ensureSnapshot(workspaceId);
	const ids = new Set(commentIds);
	for (const comment of snapshot.comments) {
		if (!ids.has(comment.id)) continue;
		comment.status = "sent";
		comment.sentAt = Date.now();
		comment.sessionId = sessionId;
		snapshot.review.fileSessions = {
			...snapshot.review.fileSessions,
			[reviewSessionKey(comment)]: sessionId,
		};
	}
	persistAndPublish(workspaceId, snapshot);
}

/**
 * Undo an optimistic {@link markCommentsSent} when the send it fired was REJECTED before the agent's
 * turn began (a bad model, a missing/expired key — see `host`'s `fireReviewPrompt`). Without this the
 * comments stay `sent` forever, and the sidebar drops their send/edit/delete actions, so a review that
 * never actually reached the agent can't be delivered without recreating every remark.
 *
 * Roll the named comments still pinned to `sessionId` back to `draft` (clearing `sentAt`/`sessionId`),
 * then **unpin** any `fileSessions` key pointing at that session once no comment references it any more —
 * so a chat spun up solely for this failed send doesn't linger as the file's pin. A key still carrying
 * another comment's discussion keeps its pin (the reused-chat case). No-op if nothing matches (the send
 * was accepted, or a concurrent resolve/edit already moved these comments on).
 *
 * Reads with {@link load}, never {@link ensureSnapshot}: this runs DETACHED, after the send's lock is
 * released, so a `review.close` Clear can archive the records and install a fresh active review first —
 * rollback must then be a clean no-op against that fresh state, never reach into the archive. Fully
 * synchronous (no `await` between read and write), so like `reanchorWorkspace` it stays correct without
 * the lock.
 */
export function rollbackSend(workspaceId: string, commentIds: string[], sessionId: string): void {
	const snapshot = load(workspaceId);
	if (snapshot?.review.status !== "open") return;
	const ids = new Set(commentIds);
	let changed = false;
	for (const comment of snapshot.comments) {
		if (!ids.has(comment.id) || comment.status !== "sent" || comment.sessionId !== sessionId)
			continue;
		comment.status = "draft";
		delete comment.sentAt;
		delete comment.sessionId;
		changed = true;
	}
	if (!changed) return;
	// Drop the pin only if the rolled-back session no longer backs any comment — a reused chat with
	// other sent/resolved remarks keeps it.
	const stillReferenced = snapshot.comments.some((c) => c.sessionId === sessionId);
	if (!stillReferenced && snapshot.review.fileSessions) {
		const kept = Object.fromEntries(
			Object.entries(snapshot.review.fileSessions).filter(([, sid]) => sid !== sessionId),
		);
		snapshot.review.fileSessions = kept;
	}
	persistAndPublish(workspaceId, snapshot);
}

/** The chat pinned for a file (or the review-level bucket), if one exists — the session every later
 * send for that key must follow up into. */
export function fileReviewSession(workspaceId: string, key: string): string | undefined {
	return ensureSnapshot(workspaceId).review.fileSessions?.[key];
}

function applyAgentResolution(
	snapshot: ReviewSnapshot,
	commentId: string,
	note?: string,
): ReviewComment | null {
	const comment = snapshot.comments.find((candidate) => candidate.id === commentId);
	if (!comment) return null;
	if (comment.status === "resolved") throw new Error(`Comment ${commentId} is already resolved.`);
	if (comment.status !== "sent")
		throw new Error(`Comment ${commentId} was not sent to a session (status: ${comment.status}).`);
	comment.status = "resolved";
	comment.resolvedBy = "agent";
	comment.resolvedAt = Date.now();
	if (note?.trim()) comment.resolveNote = note.trim();
	return comment;
}

/**
 * The agent's `resolve_comment` landing (via the host-installed seam). The tool only holds the comment id,
 * so search active reviews first and then archives (Clear can land while an agent turn is still in flight).
 * Anything other than `sent` fails loud so the model corrects itself instead of silently resolving nothing.
 */
export function resolveCommentFromAgent(commentId: string, note?: string): ReviewComment {
	let files: string[] = [];
	try {
		files = readdirSync(reviewsDir()).filter((file) => file.endsWith(".json"));
	} catch {
		// no reviews dir yet
	}
	for (const file of files) {
		const workspaceId = file.slice(0, -".json".length);
		// This is a SCAN across every workspace, so one damaged file must not fail a resolve that belongs
		// to another review — it's logged and skipped here, and still refused loudly to that workspace's
		// own reads (see `load`).
		let snapshot: ReviewSnapshot | null = null;
		try {
			snapshot = load(workspaceId);
		} catch (err) {
			console.warn(`review ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`);
			continue;
		}
		if (snapshot?.review.status !== "open") continue;
		const comment = applyAgentResolution(snapshot, commentId, note);
		if (!comment) continue;
		persistAndPublish(workspaceId, snapshot);
		return comment;
	}

	for (const file of archivedReviewFiles()) {
		let snapshot: ReviewSnapshot | null = null;
		try {
			snapshot = readSnapshot(file);
		} catch (err) {
			console.warn(`review archive ${file}: ${err instanceof Error ? err.message : String(err)}`);
			continue;
		}
		if (snapshot?.review.status !== "closed") continue;
		const comment = applyAgentResolution(snapshot, commentId, note);
		if (!comment) continue;
		// Archived state is not the active review: persist the record update, but publish no UI snapshot.
		saveFile(file, snapshot);
		return comment;
	}
	throw new Error(`Unknown review comment: ${commentId}. Use an id from the review package.`);
}

/** Purge a workspace's active review + closed archives (workspace archive). */
export function removeWorkspaceReviews(workspaceId: string): void {
	rmSync(reviewFile(workspaceId), { force: true });
	rmSync(archiveWorkspaceDir(workspaceId), { recursive: true, force: true });
}
