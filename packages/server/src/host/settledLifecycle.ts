import { statSync } from "node:fs";
import { join } from "node:path";
import type { SessionStateRecord, Workspace } from "@thinkrail/contracts";
import { listSessions } from "../agent";
import { findBranchReviewOutcome } from "../branch-review";
import { logger } from "../log";
import { listProjects } from "../projects";
import { getConfig } from "../settings";
import {
	backfillWorkspaceActivity,
	listWorkspaceRecords,
	recordWorkspaceActivity,
	setWorkspaceReview,
} from "../workspaces";

const log = logger("settled-lifecycle");

export const REVIEW_REFRESH_INTERVAL_MS = 5 * 60_000;
const REVIEW_REFRESH_CONCURRENCY = 3;
const DAY_MS = 24 * 60 * 60_000;

const passesInFlight = new Map<string, Promise<void>>();

export function stampSessionActivity(record: SessionStateRecord): void {
	if (record.state.execution !== "running") return;
	recordWorkspaceActivity(record.workspaceId);
}

/** Rows whose review state can still change the partition. */
export function candidateLiveRows(rows: readonly Workspace[], now = Date.now()): Workspace[] {
	const idleDays = getConfig().settleIdleDays;
	return rows.filter((row) => {
		if (row.kind === "default") return false;
		if (row.settledOverride === "settled") return false;
		if (row.review?.state === "merged" || row.review?.state === "closed") return false;
		if (row.settledOverride === "active" || row.review?.state === "open") return true;
		if (idleDays !== null && row.lastActiveAt !== undefined) {
			return now - row.lastActiveAt <= idleDays * DAY_MS;
		}
		return true;
	});
}

async function backfillActivity(row: Workspace): Promise<void> {
	if (row.lastActiveAt !== undefined) return;
	let at: number | undefined;
	try {
		const sessions = await listSessions(row.id, row.worktreePath);
		at = sessions.reduce<number | undefined>(
			(latest, session) =>
				latest === undefined || session.updatedAt > latest ? session.updatedAt : latest,
			undefined,
		);
	} catch {
		at = undefined;
	}
	if (at === undefined && row.kind === undefined) {
		try {
			at = statSync(join(row.worktreePath, ".git")).mtimeMs;
		} catch {
			at = undefined;
		}
	}
	backfillWorkspaceActivity(row.id, at ?? Date.now());
}

async function refreshReview(row: Workspace, fresh: boolean): Promise<void> {
	try {
		const outcome = await findBranchReviewOutcome(row.worktreePath, row.branch, { fresh });
		if (outcome.reliable) setWorkspaceReview(row.id, outcome.value);
	} catch {
		log.warn(`review refresh failed for workspace ${row.id}`);
	}
}

async function forEachBounded<T>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<void>,
): Promise<void> {
	const queue = [...items];
	await Promise.all(
		Array.from({ length: Math.min(limit, queue.length) }, async () => {
			for (let next = queue.shift(); next !== undefined; next = queue.shift()) await work(next);
		}),
	);
}

/** Backfills missing activity stamps, then refreshes the review of every candidate-live row. */
export function scheduleLifecyclePass(
	projectId: string,
	opts: { fresh?: boolean } = {},
): Promise<void> {
	const running = passesInFlight.get(projectId);
	if (running) return running;
	const pass = (async () => {
		const rows = listWorkspaceRecords(projectId);
		await forEachBounded(rows, REVIEW_REFRESH_CONCURRENCY, backfillActivity);
		const candidates = candidateLiveRows(listWorkspaceRecords(projectId));
		await forEachBounded(candidates, REVIEW_REFRESH_CONCURRENCY, (row) =>
			refreshReview(row, opts.fresh === true),
		);
	})().finally(() => passesInFlight.delete(projectId));
	passesInFlight.set(projectId, pass);
	return pass;
}

export async function refreshOpenProjectReviews(): Promise<void> {
	for (const project of listProjects()) {
		await scheduleLifecyclePass(project.id, { fresh: true });
	}
}
