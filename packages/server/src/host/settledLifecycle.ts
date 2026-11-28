import { statSync } from "node:fs";
import { join } from "node:path";
import type { SessionStateRecord, Workspace } from "@thinkrail/contracts";
import { listSessions } from "../agent";
import { findBranchReviewOutcome } from "../branch-review";
import { logger } from "../log";
import { onBaseBranch } from "../pr";
import { listProjects } from "../projects";
import { getConfig } from "../settings";
import {
	backfillWorkspaceActivity,
	isChatsContainer,
	isChatsContainerId,
	isChatWorkspace,
	isChatWorkspaceId,
	listAllWorkspaceRecords,
	listWorkspaceRecords,
	recordWorkspaceActivity,
	setWorkspaceReview,
	syncWorkspaceBranch,
} from "../workspaces";
import { trailingSingleFlight } from "./sessionStateList";

const log = logger("settled-lifecycle");

export const REVIEW_REFRESH_INTERVAL_MS = 5 * 60_000;
const REVIEW_REFRESH_CONCURRENCY = 3;
const DAY_MS = 24 * 60 * 60_000;

const IDLE_REVIEW_REFRESH_MS = 30 * 60_000;

const passesInFlight = new Map<string, Promise<void>>();
type ReviewRefreshStamp = { branch: string; at: number };
const reviewRefreshedAt = new Map<string, ReviewRefreshStamp>();
type ReviewRefreshQueue = {
	run: () => Promise<void>;
	latest: Promise<void> | null;
};
const settledReviewRefreshes = new Map<string, ReviewRefreshQueue>();

export function stampSessionActivity(record: SessionStateRecord): void {
	if (record.state.execution !== "running") return;
	recordWorkspaceActivity(record.workspaceId);
}

export function stampTerminalActivity(workspaceId: string | null, data: string): void {
	if (!workspaceId) return;
	for (let i = 0; i < data.length; i += 3) {
		if (
			data[i] === "\u001b" &&
			data[i + 1] === "[" &&
			(data[i + 2] === "I" || data[i + 2] === "O")
		) {
			continue;
		}
		recordWorkspaceActivity(workspaceId);
		return;
	}
}

export function reviewRefreshRows(
	rows: readonly Workspace[],
	now = Date.now(),
	refreshedAt: ReadonlyMap<string, ReviewRefreshStamp> = reviewRefreshedAt,
): Workspace[] {
	const idleDays = getConfig().settleIdleDays;
	return rows.filter((row) => {
		if (isChatWorkspace(row)) return false;
		if (row.kind === "default") return !onBaseBranch(row);
		if (row.settledOverride === "settled") return false;
		if (
			(row.review?.state === "merged" || row.review?.state === "closed") &&
			row.review.changedAt !== undefined
		)
			return false;
		if (row.settledOverride === "active" || row.review?.state === "open") return true;
		const idle =
			idleDays !== null &&
			row.lastActiveAt !== undefined &&
			now - row.lastActiveAt > idleDays * DAY_MS;
		if (!idle) return true;
		const refreshed = refreshedAt.get(row.id);
		return (
			refreshed === undefined ||
			refreshed.branch !== row.branch ||
			now - refreshed.at >= IDLE_REVIEW_REFRESH_MS
		);
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
	if (at === undefined && row.kind !== "default" && !isChatWorkspace(row)) {
		try {
			at = statSync(join(row.worktreePath, ".git")).mtimeMs;
		} catch {
			at = undefined;
		}
	}
	try {
		backfillWorkspaceActivity(row.id, at ?? Date.now());
	} catch {
		log.warn(`activity backfill failed for workspace ${row.id}`);
	}
}

export async function findWorkspaceReviewOutcome(
	workspace: Pick<Workspace, "worktreePath" | "branch" | "baseBranch">,
	opts: { fresh: boolean },
) {
	if (onBaseBranch(workspace)) return { reliable: true, value: null };
	return findBranchReviewOutcome(workspace.worktreePath, workspace.branch, opts);
}

async function refreshReview(row: Workspace, fresh: boolean): Promise<void> {
	try {
		const outcome = await findWorkspaceReviewOutcome(row, { fresh });
		if (outcome.reliable) {
			reviewRefreshedAt.set(row.id, { branch: row.branch, at: Date.now() });
			setWorkspaceReview(row.id, outcome.value, row.branch);
		}
	} catch {
		log.warn(`review refresh failed for workspace ${row.id}`);
	}
}

export function refreshReviewAfterAgentSettled(workspaceId: string): Promise<void> {
	if (isChatWorkspaceId(workspaceId)) return Promise.resolve();
	let queue = settledReviewRefreshes.get(workspaceId);
	if (!queue) {
		queue = {
			run: trailingSingleFlight(async () => {
				syncWorkspaceBranch(workspaceId);
				const row = listAllWorkspaceRecords().find((candidate) => candidate.id === workspaceId);
				if (row && !isChatWorkspace(row)) await refreshReview(row, true);
			}),
			latest: null,
		};
		settledReviewRefreshes.set(workspaceId, queue);
	}
	const pending = queue.run();
	queue.latest = pending;
	return pending.finally(() => {
		if (settledReviewRefreshes.get(workspaceId) === queue && queue.latest === pending) {
			settledReviewRefreshes.delete(workspaceId);
		}
	});
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

/** Backfills missing activity stamps, then refreshes the review of every candidate row. */
export function scheduleLifecyclePass(
	projectId: string,
	opts: { fresh?: boolean } = {},
): Promise<void> {
	const running = passesInFlight.get(projectId);
	if (running) return running;
	if (isChatsContainerId(projectId)) return Promise.resolve();
	const pass = (async () => {
		const rows = listWorkspaceRecords(projectId);
		await forEachBounded(rows, REVIEW_REFRESH_CONCURRENCY, backfillActivity);
		const candidates = reviewRefreshRows(listWorkspaceRecords(projectId));
		await forEachBounded(candidates, REVIEW_REFRESH_CONCURRENCY, (row) =>
			refreshReview(row, opts.fresh === true),
		);
	})().finally(() => passesInFlight.delete(projectId));
	passesInFlight.set(projectId, pass);
	return pass;
}

export async function refreshOpenProjectReviews(): Promise<void> {
	for (const project of listProjects()) {
		if (isChatsContainer(project)) continue;
		try {
			await scheduleLifecyclePass(project.id, { fresh: true });
		} catch {
			log.warn(`settled lifecycle pass failed for project ${project.id}`);
		}
	}
}
