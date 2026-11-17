import { createHash } from "node:crypto";
import {
	type IndependentReviewMode,
	isPrBabysitItemStatus,
	isReviewFindingSeverity,
	normalizePrBabysitConfig,
	PR_BABYSIT_ITEM_SOURCES,
	type PrBabysitItem,
	type PrBabysitItemSource,
	type PrBabysitItemStatus,
	type PrBabysitItemType,
	type PrBabysitSessionState,
	type PrBabysitSessionStatus,
	type ReviewFindingSeverity,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { isFailedCheck, isIgnoredComment, type PrSnapshot, type PrThreadComment } from "./github";

const STORE_VERSION = 1;

export interface StoreBackend {
	load(): unknown;
	save(store: unknown): void;
}

/** Which status an item may move to from where it is; anything else is a bug or a stale client click. */
const ITEM_TRANSITIONS: Record<PrBabysitItemStatus, readonly PrBabysitItemStatus[]> = {
	pending_review_approval: ["queued", "dismissed", "resolved"],
	queued: ["working", "dismissed", "resolved", "needs_human"],
	working: ["pushed", "needs_human", "queued", "resolved"],
	pushed: ["queued", "resolved"],
	needs_human: ["queued", "pushed", "dismissed", "resolved"],
	resolved: ["queued"],
	dismissed: ["queued"],
};

export function canTransition(from: PrBabysitItemStatus, to: PrBabysitItemStatus): boolean {
	return from === to || ITEM_TRANSITIONS[from].includes(to);
}

export function transitionItem(
	item: PrBabysitItem,
	to: PrBabysitItemStatus,
	now: number,
	patch: Partial<Omit<PrBabysitItem, "itemId" | "status">> = {},
): PrBabysitItem {
	if (!canTransition(item.status, to)) {
		throw new CodedError(
			"PR_BABYSIT_BAD_TRANSITION",
			`A ${item.status.replaceAll("_", " ")} item cannot become ${to.replaceAll("_", " ")}`,
		);
	}
	const next: PrBabysitItem = { ...item, ...patch, status: to, updatedAt: now };
	if (to === "queued" || to === "working") delete next.errorMessage;
	return next;
}

export function cycleCapReached(session: PrBabysitSessionState): boolean {
	return session.cycleCount >= session.config.maxPushCycles;
}

export function hasActiveWork(session: PrBabysitSessionState): boolean {
	return (
		session.reviewing ||
		session.checks === "pending" ||
		session.items.some((item) => item.status === "queued" || item.status === "working")
	);
}

/** The status the drawer headlines, derived — never stored independently of the items. */
export function sessionStatus(session: PrBabysitSessionState): PrBabysitSessionStatus {
	if (!session.active) {
		return session.status === "merged" || session.status === "closed" || session.status === "error"
			? session.status
			: "stopped";
	}
	if (session.items.some((item) => item.status === "working")) return "fixing";
	if (session.reviewing) return "reviewing";
	if (cycleCapReached(session) || session.items.some((item) => item.status === "needs_human"))
		return "needs_human";
	return "watching";
}

function stableId(prefix: string, ...parts: Array<string | number | undefined>): string {
	const hash = createHash("sha256")
		.update(parts.map((part) => String(part ?? "")).join("\u0000"))
		.digest("hex")
		.slice(0, 16);
	return `${prefix}:${hash}`;
}

export function threadItemId(threadId: string): string {
	return `thread:${threadId}`;
}

export function checkItemId(name: string, headOid: string): string {
	return stableId("check", name, headOid);
}

export function findingItemId(finding: {
	path?: string | undefined;
	line?: number | undefined;
	summary: string;
}): string {
	return stableId("finding", finding.path, finding.line, finding.summary.trim().toLowerCase());
}

const SUMMARY_LIMIT = 400;

function clip(text: string, max: number): string {
	const trimmed = text.trim();
	return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** The newest comment on a thread the babysitter should answer, or `null` when the last word is ours. */
export function lastActionableComment(
	comments: readonly PrThreadComment[],
	viewerLogin: string | undefined,
): PrThreadComment | null {
	const last = comments.at(-1);
	if (!last || isIgnoredComment(last, viewerLogin)) return null;
	return last;
}

function threadSummary(comments: readonly PrThreadComment[], viewerLogin: string | undefined) {
	const human = comments.filter((comment) => !isIgnoredComment(comment, viewerLogin));
	return clip(human[0]?.body ?? comments[0]?.body ?? "", SUMMARY_LIMIT);
}

/**
 * Fold a fresh PR snapshot into the session's items — pure. Unresolved threads whose newest comment is
 * someone else's queue (again, once a newer comment arrives after we answered); threads resolved on
 * GitHub resolve; failing checks on the current head queue when `fixFailingChecks` is on, and queued
 * checks of an older head are superseded.
 */
export function syncSnapshotItems(
	session: PrBabysitSessionState,
	snapshot: PrSnapshot,
	now: number,
): { items: PrBabysitItem[]; queued: string[] } {
	const byId = new Map(session.items.map((item) => [item.itemId, item]));
	const queued: string[] = [];
	const put = (item: PrBabysitItem) => byId.set(item.itemId, item);

	for (const thread of snapshot.threads) {
		const itemId = threadItemId(thread.id);
		const existing = byId.get(itemId);
		if (thread.isResolved) {
			if (existing && canTransition(existing.status, "resolved") && existing.status !== "working")
				put(transitionItem(existing, "resolved", now));
			continue;
		}
		if (thread.isOutdated && !existing) continue;
		const actionable = lastActionableComment(thread.comments, session.viewerLogin);
		if (!actionable) continue;
		const line = thread.line ?? thread.originalLine;
		const fields = {
			threadId: thread.id,
			lastCommentId: actionable.databaseId,
			author: actionable.author,
			summary: threadSummary(thread.comments, session.viewerLogin),
			...(thread.path ? { path: thread.path } : {}),
			...(line !== undefined ? { line } : {}),
			...(actionable.url ? { detailsUrl: actionable.url } : {}),
		};
		if (!existing) {
			put({
				itemId,
				source: "github_thread",
				itemType: "review_thread",
				status: "queued",
				updatedAt: now,
				...fields,
			});
			queued.push(itemId);
			continue;
		}
		const newer = actionable.databaseId > (existing.lastCommentId ?? 0);
		if (!newer || existing.status === "working" || existing.status === "queued") continue;
		if (existing.status === "dismissed") {
			put({ ...existing, ...fields, updatedAt: now });
			continue;
		}
		put(transitionItem(existing, "queued", now, fields));
		queued.push(itemId);
	}

	if (session.config.fixFailingChecks) {
		const head = snapshot.headRefOid;
		for (const check of snapshot.checkRuns) {
			if (!isFailedCheck(check)) continue;
			const itemId = checkItemId(check.name, head);
			if (byId.has(itemId)) continue;
			put({
				itemId,
				source: "ci_check",
				itemType: "check_run",
				status: "queued",
				summary: clip(`${check.name} ${check.conclusion ?? "failed"}`, SUMMARY_LIMIT),
				headOid: head,
				...(check.detailsUrl ? { detailsUrl: check.detailsUrl } : {}),
				updatedAt: now,
			});
			queued.push(itemId);
		}
		for (const item of byId.values()) {
			if (item.source === "ci_check" && item.headOid !== head && item.status === "queued")
				put(transitionItem(item, "resolved", now));
		}
	}
	return { items: [...byId.values()], queued };
}

export interface ReviewFinding {
	path?: string;
	line?: number;
	severity: ReviewFindingSeverity;
	summary: string;
	suggestedFix?: string;
}

/** Where a reviewer finding lands for a review behavior. */
export function findingStatus(
	severity: ReviewFindingSeverity,
	mode: IndependentReviewMode,
): PrBabysitItemStatus {
	if (mode === "review_and_auto_queue" && severity !== "suggestion") return "queued";
	return "pending_review_approval";
}

/** Merge a review's findings into the items — a finding already on record (same path, line, summary) is not refiled. */
export function applyFindings(
	session: PrBabysitSessionState,
	findings: readonly ReviewFinding[],
	headOid: string,
	reviewerModel: string | undefined,
	now: number,
): { items: PrBabysitItem[]; created: string[] } {
	const byId = new Map(session.items.map((item) => [item.itemId, item]));
	const created: string[] = [];
	for (const finding of findings) {
		const itemId = findingItemId(finding);
		if (byId.has(itemId)) continue;
		byId.set(itemId, {
			itemId,
			source: "independent_review",
			itemType: "finding",
			severity: finding.severity,
			summary: clip(finding.summary, SUMMARY_LIMIT),
			status: findingStatus(finding.severity, session.config.independentReviewMode),
			headOid,
			updatedAt: now,
			...(finding.path ? { path: finding.path } : {}),
			...(finding.line !== undefined ? { line: finding.line } : {}),
			...(finding.suggestedFix ? { suggestedFix: clip(finding.suggestedFix, 2000) } : {}),
			...(reviewerModel ? { reviewerModel } : {}),
		});
		created.push(itemId);
	}
	return { items: [...byId.values()], created };
}

/** The next item the fixer takes: oldest queued first. */
export function nextQueuedItem(session: PrBabysitSessionState): PrBabysitItem | null {
	let next: PrBabysitItem | null = null;
	for (const item of session.items) {
		if (item.status !== "queued") continue;
		if (!next || item.updatedAt < next.updatedAt) next = item;
	}
	return next;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const ITEM_TYPES: readonly PrBabysitItemType[] = ["review_thread", "check_run", "finding"];

function normalizeItem(raw: unknown): PrBabysitItem | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const itemId = str(r.itemId);
	const summary = typeof r.summary === "string" ? r.summary : undefined;
	const source = PR_BABYSIT_ITEM_SOURCES.find((value) => value === r.source) as
		| PrBabysitItemSource
		| undefined;
	const itemType = ITEM_TYPES.find((value) => value === r.itemType);
	if (!itemId || summary === undefined || !source || !itemType || !isPrBabysitItemStatus(r.status))
		return null;
	// A fix that was running when the host stopped never finished: it goes back on the queue.
	const status: PrBabysitItemStatus = r.status === "working" ? "queued" : r.status;
	const item: PrBabysitItem = {
		itemId,
		source,
		itemType,
		summary,
		status,
		updatedAt: num(r.updatedAt) ?? 0,
	};
	for (const key of [
		"threadId",
		"path",
		"author",
		"suggestedFix",
		"detailsUrl",
		"commitSha",
		"errorMessage",
		"reviewerModel",
		"headOid",
	] as const) {
		const value = str(r[key]);
		if (value) item[key] = value;
	}
	const lastCommentId = num(r.lastCommentId);
	if (lastCommentId !== undefined) item.lastCommentId = lastCommentId;
	const line = num(r.line);
	if (line !== undefined) item.line = line;
	if (isReviewFindingSeverity(r.severity)) item.severity = r.severity;
	if (r.postedToGithub === true) item.postedToGithub = true;
	return item;
}

export function normalizeSession(raw: unknown): PrBabysitSessionState | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const workspaceId = str(r.workspaceId);
	const owner = str(r.owner);
	const repo = str(r.repo);
	const prNumber = num(r.prNumber);
	if (!workspaceId || !owner || !repo || prNumber === undefined) return null;
	const items = Array.isArray(r.items)
		? r.items.map(normalizeItem).filter((item): item is PrBabysitItem => item !== null)
		: [];
	const session: PrBabysitSessionState = {
		workspaceId,
		owner,
		repo,
		prNumber,
		headRefName: str(r.headRefName) ?? "",
		baseRefName: str(r.baseRefName) ?? "",
		active: r.active === true,
		status: "watching",
		config: normalizePrBabysitConfig(r.config),
		cycleCount: num(r.cycleCount) ?? 0,
		reviewing: false,
		items,
		updatedAt: num(r.updatedAt) ?? 0,
	};
	for (const key of [
		"headOid",
		"prUrl",
		"lastReviewedOid",
		"babysitSessionId",
		"viewerLogin",
		"error",
	] as const) {
		const value = str(r[key]);
		if (value) session[key] = value;
	}
	const stored = str(r.status);
	if (!session.active && (stored === "merged" || stored === "closed" || stored === "error"))
		session.status = stored;
	session.status = sessionStatus(session);
	return session;
}

export interface PrBabysitStore {
	get(workspaceId: string): PrBabysitSessionState | null;
	list(): PrBabysitSessionState[];
	put(session: PrBabysitSessionState): PrBabysitSessionState;
	remove(workspaceId: string): void;
}

/** The persisted session table — every write is saved at once, so a restart never re-handles a thread. */
export function createPrBabysitStore(backend: StoreBackend): PrBabysitStore {
	const sessions = new Map<string, PrBabysitSessionState>();
	const raw = backend.load();
	const stored =
		raw && typeof raw === "object" ? (raw as { sessions?: unknown }).sessions : undefined;
	if (Array.isArray(stored)) {
		for (const entry of stored) {
			const session = normalizeSession(entry);
			if (session) sessions.set(session.workspaceId, session);
		}
	}
	const persist = () => backend.save({ version: STORE_VERSION, sessions: [...sessions.values()] });
	return {
		get: (workspaceId) => sessions.get(workspaceId) ?? null,
		list: () => [...sessions.values()],
		put(session) {
			const next = { ...session, status: sessionStatus(session) };
			sessions.set(next.workspaceId, next);
			persist();
			return next;
		},
		remove(workspaceId) {
			if (sessions.delete(workspaceId)) persist();
		},
	};
}
