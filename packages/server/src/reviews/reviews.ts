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
import { logger } from "../log";
import { dataDir } from "../persistence";
import { getWorkspace } from "../workspaces";
import { buildTextQuote, hashContent, lineRangeOf, reanchor, textQuoteOf } from "./anchoring";
import { renderPackage } from "./packageRender";

const log = logger("reviews");

let publish: (payload: ReviewChangedPayload) => void = () => {};
export function setReviewPublisher(fn: (payload: ReviewChangedPayload) => void): void {
	publish = fn;
}

function reviewsDir(): string {
	return join(dataDir(), "reviews");
}

const SAFE_ID = /^[\w-]+$/;

class InvalidReviewIdError extends Error {}
class DamagedReviewFileError extends Error {}

function assertSafeId(id: string, kind: "workspace" | "review"): void {
	if (!SAFE_ID.test(id)) throw new InvalidReviewIdError(`Invalid ${kind} id: ${id}`);
}

function reviewFile(workspaceId: string): string {
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
		throw new DamagedReviewFileError(
			`Review file ${file} is damaged and was left in place — repair or remove it.`,
		);
	}
}

export function reviewReadFailure(error: unknown): string {
	if (error instanceof DamagedReviewFileError) return "damaged";
	if (error instanceof InvalidReviewIdError) return "invalid id";
	const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
	if (code === "EACCES" || code === "EPERM") return "permission denied";
	if (code === "EISDIR" || code === "ENOTDIR") return "not a file";
	return "read failure";
}

function load(workspaceId: string): ReviewSnapshot | null {
	return readSnapshot(reviewFile(workspaceId));
}

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
		} catch {
			log.warn(`review archive could not be listed for workspace ${workspace.name}`);
		}
	}
	return files;
}

function persistAndPublish(workspaceId: string, snapshot: ReviewSnapshot): void {
	save(workspaceId, snapshot);
	publish({ workspaceId, ...snapshot });
}

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

async function freshSnapshot(workspaceId: string): Promise<ReviewSnapshot> {
	const ws = getWorkspace(workspaceId);
	const ref = (await resolveDiffRange(ws)).originalRef ?? diffBaseRef(ws);
	const base = resolveCommitOid(ws.worktreePath, ref);
	getWorkspace(workspaceId);
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

const ensuring = new Map<string, Promise<ReviewSnapshot>>();

function ensureSnapshot(workspaceId: string): Promise<ReviewSnapshot> {
	const pending = ensuring.get(workspaceId);
	if (pending) return pending;
	const existing = load(workspaceId);
	if (existing?.review.status === "open") return Promise.resolve(existing);
	const flight = (async () => {
		const snapshot = await freshSnapshot(workspaceId);
		if (existing) archiveRecords(workspaceId, existing);
		save(workspaceId, snapshot);
		return snapshot;
	})().finally(() => {
		if (ensuring.get(workspaceId) === flight) ensuring.delete(workspaceId);
	});
	ensuring.set(workspaceId, flight);
	return flight;
}

function openSnapshot(workspaceId: string): ReviewSnapshot | null {
	const existing = load(workspaceId);
	return existing?.review.status === "open" ? existing : null;
}

function reanchorSnapshot(workspaceId: string, snapshot: ReviewSnapshot): boolean {
	const ws = getWorkspace(workspaceId);
	let changed = false;
	snapshot.comments = snapshot.comments.map((comment) => {
		const anchor = comment.anchor;
		if (!anchor || anchor.side === "base") return comment;
		const content = readWorktreeFile(ws.worktreePath, anchor.path);
		const result = reanchor(anchor, content);
		const state =
			result.state === "anchored" && comment.anchorState === "moved" ? "moved" : result.state;
		if (state === comment.anchorState && result.anchor === anchor) return comment;
		changed = true;
		return { ...comment, anchorState: state, anchor: result.anchor };
	});
	return changed;
}

export async function getReviewSnapshot(workspaceId: string): Promise<ReviewSnapshot> {
	const snapshot = openSnapshot(workspaceId);
	if (!snapshot) return ensureSnapshot(workspaceId);
	if (reanchorSnapshot(workspaceId, snapshot)) persistAndPublish(workspaceId, snapshot);
	return snapshot;
}

export function reanchorWorkspace(workspaceId: string): void {
	try {
		const snapshot = openSnapshot(workspaceId);
		if (!snapshot || snapshot.comments.length === 0) return;
		if (reanchorSnapshot(workspaceId, snapshot)) persistAndPublish(workspaceId, snapshot);
	} catch {}
}

export function anchorProblem(workspaceId: string, path: string, startLine: number): string | null {
	const ws = getWorkspace(workspaceId);
	const content = readWorktreeFile(ws.worktreePath, path);
	if (content === null)
		return `No file "${path}" in the worktree — a finding must cite a real changed file (check the path).`;
	const lines = content.split("\n").length;
	if (startLine > lines)
		return `"${path}" has ${lines} line(s); line ${startLine} is past the end — cite a line that exists.`;
	return null;
}

export interface AddCommentInput {
	workspaceId: string;
	kind: ReviewCommentKind;
	anchor: ReviewAnchor | null;
	body: string;
	scope?: GitDiffScope;
	author?: "user" | "agent";
	origin?: { todoId: string; reviewedSha: string; sessionId: string };
}

function captureAnchor(anchor: ReviewAnchor, content: string): ReviewAnchor {
	const range = lineRangeOf(anchor);
	const selectors =
		range && !textQuoteOf(anchor)
			? [...anchor.selectors, buildTextQuote(content, range.startLine, range.endLine)]
			: anchor.selectors;
	return { ...anchor, contentHash: hashContent(content), selectors };
}

export async function addComment(input: AddCommentInput): Promise<ReviewComment> {
	const body = input.body.trim();
	if (!body) throw new Error("A comment body is required.");
	if (input.kind !== "review" && !input.anchor?.path)
		throw new Error(`A ${input.kind} comment requires an anchor path.`);
	if (input.kind === "review" && input.anchor)
		throw new Error("A review-level comment carries no anchor.");
	let anchor = input.anchor;
	if (anchor) {
		const ws = getWorkspace(input.workspaceId);
		if (anchor.side === "base") {
			const originalRef = (await resolveDiffRange(ws, input.scope)).originalRef;
			if (!originalRef)
				throw new Error("This diff has no base side to comment on (nothing precedes the change).");
			const baseRef = resolveCommitOid(ws.worktreePath, originalRef);
			if (!baseRef)
				throw new Error(`Can't pin the base side of this diff: ${originalRef} names no commit.`);
			const content = readBlobAt(ws.worktreePath, baseRef, anchor.path);
			if (content === null)
				throw new Error(`The base (${baseRef}) has no ${anchor.path} to comment on.`);
			anchor = captureAnchor(
				{ ...anchor, baseRef, ...(input.scope ? { scope: input.scope } : {}) },
				content,
			);
		} else {
			const content = readWorktreeFile(ws.worktreePath, anchor.path);
			if (content !== null) anchor = captureAnchor(anchor, content);
		}
	}
	const snapshot = await ensureSnapshot(input.workspaceId);
	const comment: ReviewComment = {
		id: `rc_${randomUUID().slice(0, 8)}`,
		reviewId: snapshot.review.id,
		kind: input.kind,
		anchor,
		body,
		status: "draft",
		anchorState: "anchored",
		...(input.author === "agent" ? { author: "agent" as const } : {}),
		...(input.origin ? { origin: input.origin } : {}),
		createdAt: Date.now(),
	};
	snapshot.comments.push(comment);
	const key = reviewSessionKey(comment);
	if (snapshot.review.doneFiles?.includes(key))
		snapshot.review.doneFiles = snapshot.review.doneFiles.filter((p) => p !== key);
	persistAndPublish(input.workspaceId, snapshot);
	return comment;
}

export async function markFileDone(workspaceId: string, path: string): Promise<void> {
	const snapshot = await ensureSnapshot(workspaceId);
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

export async function updateComment(input: {
	workspaceId: string;
	id: string;
	body?: string;
	status?: ReviewCommentStatus;
}): Promise<ReviewComment> {
	const snapshot = await ensureSnapshot(input.workspaceId);
	const comment = mustFind(snapshot, input.id);
	if (input.body !== undefined) {
		if (comment.status !== "draft") throw new Error("Only a draft comment's text can be edited.");
		if (!input.body.trim()) throw new Error("A comment body is required.");
		comment.body = input.body.trim();
	}
	if (input.status !== undefined && input.status !== comment.status) {
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

export async function setReflection(
	workspaceId: string,
	commentId: string,
	reflection: NonNullable<ReviewComment["reflection"]>,
): Promise<ReviewComment> {
	const snapshot = await ensureSnapshot(workspaceId);
	const comment = mustFind(snapshot, commentId);
	comment.reflection = reflection;
	persistAndPublish(workspaceId, snapshot);
	return comment;
}

export async function deleteComment(workspaceId: string, id: string): Promise<void> {
	const snapshot = await ensureSnapshot(workspaceId);
	const comment = mustFind(snapshot, id);
	if (comment.status !== "draft")
		throw new Error("Only a draft can be deleted — a sent comment is a record.");
	snapshot.comments = snapshot.comments.filter((c) => c.id !== id);
	persistAndPublish(workspaceId, snapshot);
}

export async function clearReview(workspaceId: string): Promise<ReviewSnapshot> {
	const existing = load(workspaceId);
	const fresh = await freshSnapshot(workspaceId);
	if (existing) archiveRecords(workspaceId, existing);
	persistAndPublish(workspaceId, fresh);
	return fresh;
}

export async function sendableComments(
	workspaceId: string,
	commentIds?: string[],
): Promise<ReviewComment[]> {
	const snapshot = await getReviewSnapshot(workspaceId);
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

export async function buildSendPackage(
	workspaceId: string,
	comments: ReviewComment[],
): Promise<string> {
	const ws = getWorkspace(workspaceId);
	const snapshot = await ensureSnapshot(workspaceId);
	return renderPackage({
		review: snapshot.review,
		branch: ws.branch,
		baseBranch: diffBaseRef(ws),
		comments,
		readFile: (path) => readWorktreeFile(ws.worktreePath, path),
		readBase: (ref, path) => readBlobAt(ws.worktreePath, ref, path),
	});
}

export const REVIEW_LEVEL_KEY = "";
export function reviewSessionKey(comment: Pick<ReviewComment, "anchor">): string {
	return comment.anchor?.path ?? REVIEW_LEVEL_KEY;
}

export async function markCommentsSent(
	workspaceId: string,
	commentIds: string[],
	sessionId: string,
): Promise<void> {
	const snapshot = await ensureSnapshot(workspaceId);
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
	const stillReferenced = snapshot.comments.some((c) => c.sessionId === sessionId);
	if (!stillReferenced && snapshot.review.fileSessions) {
		const kept = Object.fromEntries(
			Object.entries(snapshot.review.fileSessions).filter(([, sid]) => sid !== sessionId),
		);
		snapshot.review.fileSessions = kept;
	}
	persistAndPublish(workspaceId, snapshot);
}

export async function fileReviewSession(
	workspaceId: string,
	key: string,
): Promise<string | undefined> {
	return (await ensureSnapshot(workspaceId)).review.fileSessions?.[key];
}

function applyAgentResolution(
	snapshot: ReviewSnapshot,
	sessionId: string,
	commentId: string,
	note?: string,
): ReviewComment | null {
	const comment = snapshot.comments.find((candidate) => candidate.id === commentId);
	if (!comment) return null;
	if (comment.status === "resolved") throw new Error(`Comment ${commentId} is already resolved.`);
	if (comment.status !== "sent")
		throw new Error(`Comment ${commentId} was not sent to a session (status: ${comment.status}).`);
	if (comment.sessionId !== sessionId)
		throw new Error(`Comment ${commentId} was not sent to this chat.`);
	comment.status = "resolved";
	comment.resolvedBy = "agent";
	comment.resolvedAt = Date.now();
	if (note?.trim()) comment.resolveNote = note.trim();
	return comment;
}

export function resolveCommentFromAgent(
	sessionId: string,
	commentId: string,
	note?: string,
): ReviewComment {
	let files: string[] = [];
	try {
		files = readdirSync(reviewsDir()).filter((file) => file.endsWith(".json"));
	} catch {}
	for (const file of files) {
		const workspaceId = file.slice(0, -".json".length);
		let snapshot: ReviewSnapshot | null = null;
		try {
			snapshot = load(workspaceId);
		} catch (error) {
			const target = SAFE_ID.test(workspaceId) ? ` for workspace ${workspaceId}` : "";
			log.warn(`active review could not be read${target} (${reviewReadFailure(error)})`);
			continue;
		}
		if (snapshot?.review.status !== "open") continue;
		const comment = applyAgentResolution(snapshot, sessionId, commentId, note);
		if (!comment) continue;
		persistAndPublish(workspaceId, snapshot);
		return comment;
	}

	for (const file of archivedReviewFiles()) {
		let snapshot: ReviewSnapshot | null = null;
		try {
			snapshot = readSnapshot(file);
		} catch (error) {
			log.warn(`archived review could not be read (${reviewReadFailure(error)})`);
			continue;
		}
		if (snapshot?.review.status !== "closed") continue;
		const comment = applyAgentResolution(snapshot, sessionId, commentId, note);
		if (!comment) continue;
		saveFile(file, snapshot);
		return comment;
	}
	throw new Error(`Unknown review comment: ${commentId}. Use an id from the review package.`);
}

export function removeWorkspaceReviews(workspaceId: string): void {
	rmSync(reviewFile(workspaceId), { force: true });
	rmSync(archiveWorkspaceDir(workspaceId), { recursive: true, force: true });
}
