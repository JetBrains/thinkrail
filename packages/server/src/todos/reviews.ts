import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";

const REVIEWS_SUFFIX = ".reviews.json";

export interface TodoReviewRecord {
	state: "reviewed" | "changes_requested";
	reviewedShas: string[];
	feedback?: string;
	at: string;
	reviewedBy?: "agent";
	requestId?: string;
}

export interface TodoReviewMeta {
	reviewerSessionId?: string;
	pending: Record<string, { at: string; shas?: string[] }>;
}

interface ReviewsFile {
	version: 1;
	items: Record<string, TodoReviewRecord>;
	reviewerSessionId?: string;
	pending?: Record<string, { at: string; shas?: string[] }>;
	// Auto fix→re-review cycles spent per item, kept OUTSIDE `items` on purpose: a redo that can't be
	// committed (shared window / foreign dirt) drops the item's `items` entry entirely so the item reads
	// `unreviewed` again (no sha to watermark a path-list delta against — see `todos/artifacts.ts`), but
	// the auto-cycle cap must survive that reset, else the dropped record silently regrants a spent cycle.
	autoCycles?: Record<string, number>;
}

// The session id was validated as a safe path segment by `TodoStore` before any record exists.
function reviewsPath(root: string, sessionId: string): string {
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
		(o.requestId === undefined || typeof o.requestId === "string") &&
		typeof o.at === "string"
	);
}

function parseAutoCycles(raw: unknown): Record<string, number> | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const autoCycles = Object.fromEntries(
		Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
	);
	return Object.keys(autoCycles).length > 0 ? autoCycles : undefined;
}

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
				const entry = value as Record<string, unknown> | null;
				const at = entry?.at;
				if (typeof at !== "string") continue;
				const shas =
					Array.isArray(entry?.shas) && entry.shas.every((s) => typeof s === "string")
						? (entry.shas as string[])
						: undefined;
				pending[id] = { at, ...(shas ? { shas } : {}) };
			}
			if (Object.keys(pending).length > 0) file.pending = pending;
		}
		const autoCycles = parseAutoCycles(o.autoCycles);
		if (autoCycles) file.autoCycles = autoCycles;
		return file;
	} catch {
		return { version: 1, items: {} };
	}
}

function writeFile(root: string, sessionId: string, file: ReviewsFile): void {
	const path = reviewsPath(root, sessionId);
	const empty =
		Object.keys(file.items).length === 0 &&
		!file.reviewerSessionId &&
		Object.keys(file.pending ?? {}).length === 0 &&
		Object.keys(file.autoCycles ?? {}).length === 0;
	if (empty) {
		rmSync(path, { force: true });
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(file, null, "\t")}\n`, "utf8");
	renameSync(tmp, path);
}

export function readReviewMeta(root: string, sessionId: string): TodoReviewMeta {
	const file = readFile(root, sessionId);
	const meta: TodoReviewMeta = { pending: file.pending ?? {} };
	if (file.reviewerSessionId) meta.reviewerSessionId = file.reviewerSessionId;
	return meta;
}

export function setReviewerSession(root: string, sessionId: string, reviewerId: string): void {
	const file = readFile(root, sessionId);
	file.reviewerSessionId = reviewerId;
	writeFile(root, sessionId, file);
}

export function markReviewPending(
	root: string,
	sessionId: string,
	id: string,
	shas?: string[],
): void {
	const file = readFile(root, sessionId);
	file.pending = {
		...(file.pending ?? {}),
		[id]: { at: new Date().toISOString(), ...(shas ? { shas } : {}) },
	};
	writeFile(root, sessionId, file);
}

export function clearReviewPending(root: string, sessionId: string, id: string): void {
	const file = readFile(root, sessionId);
	if (!file.pending?.[id]) return;
	delete file.pending[id];
	writeFile(root, sessionId, file);
}

export function readAutoCycles(root: string, sessionId: string, id: string): number | undefined {
	return readFile(root, sessionId).autoCycles?.[id];
}

export function setAutoCycles(root: string, sessionId: string, id: string, value: number): void {
	const file = readFile(root, sessionId);
	file.autoCycles = { ...(file.autoCycles ?? {}), [id]: value };
	writeFile(root, sessionId, file);
}

export function clearAutoCycles(root: string, sessionId: string, id: string): void {
	const file = readFile(root, sessionId);
	if (!file.autoCycles?.[id]) return;
	delete file.autoCycles[id];
	writeFile(root, sessionId, file);
}

export function readReviewRecords(
	root: string,
	sessionId: string,
): Record<string, TodoReviewRecord> {
	return readFile(root, sessionId).items;
}

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

export function restoreReviewRecord(
	root: string,
	sessionId: string,
	id: string,
	expected: TodoReviewRecord,
	previous: TodoReviewRecord | undefined,
): boolean {
	const file = readFile(root, sessionId);
	if (file.items[id]?.requestId !== expected.requestId) return false;
	if (previous) file.items[id] = previous;
	else delete file.items[id];
	writeFile(root, sessionId, file);
	return true;
}

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

export function removeSessionReviews(root: string, sessionId: string): void {
	try {
		rmSync(reviewsPath(root, sessionId), { force: true });
	} catch {}
}

/** Host-restart reconciliation — see host/SPEC.md ("reconcilePendingReviewsOnBoot"). */
export function clearAllPendingReviews(root: string): { sessionId: string; itemIds: string[] }[] {
	let names: string[];
	try {
		names = readdirSync(join(root, WORKSPACE_TODOS_DIR)).filter((n) => n.endsWith(REVIEWS_SUFFIX));
	} catch {
		return [];
	}
	const cleared: { sessionId: string; itemIds: string[] }[] = [];
	for (const name of names) {
		const sessionId = name.slice(0, -REVIEWS_SUFFIX.length);
		const file = readFile(root, sessionId);
		const itemIds = Object.keys(file.pending ?? {});
		if (itemIds.length === 0) continue;
		file.pending = {};
		writeFile(root, sessionId, file);
		cleared.push({ sessionId, itemIds });
	}
	return cleared;
}
