import type {
	DelegationRunDetails,
	SubagentRoster,
	SubagentRosterCounts,
	SubagentRosterRow,
} from "@thinkrail/contracts";
import type { DelegationService, LifecycleEvent } from "pi-delegation";

/** Progress is coalesced into at most one publish per window. */
export const ROSTER_PUBLISH_INTERVAL_MS = 1000;
/** Finished (non-failed) rows stay visible this long. Failures never expire. */
export const ROSTER_DONE_TTL_MS = 2 * 60_000;
/** Hard cap on retained terminal rows; the oldest non-failures go first. */
export const ROSTER_MAX_TERMINAL_ROWS = 50;

type RosterPublisher = (payload: { workspaceId: string }) => void;

let publisher: RosterPublisher = () => {};
export function setSubagentRosterPublisher(fn: RosterPublisher): void {
	publisher = fn;
}

export interface SubagentRosterOptions {
	workspaceId: string;
	service: DelegationService;
	titleOf: (parentSessionId: string) => string;
	now?: () => number;
	intervalMs?: number;
	doneTtlMs?: number;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

export interface SubagentRosterRegistry {
	read(): SubagentRoster;
	handle(event: LifecycleEvent): void;
	dispose(): void;
}

const LIVE = new Set(["queued", "running"]);

function isLive(row: SubagentRosterRow): boolean {
	return LIVE.has(row.status);
}

function isFailure(row: SubagentRosterRow): boolean {
	return row.status === "error";
}

function applyDetails(
	row: SubagentRosterRow,
	details: DelegationRunDetails,
	at: number,
): SubagentRosterRow {
	return {
		...row,
		status: details.status,
		task: details.task.slice(0, 2000),
		...(details.model !== undefined ? { model: details.model } : {}),
		...(details.thinkingLevel !== undefined ? { thinkingLevel: details.thinkingLevel } : {}),
		...(details.activity !== undefined ? { activity: details.activity.slice(0, 300) } : {}),
		...(details.abortReason !== undefined ? { abortReason: details.abortReason } : {}),
		usage: details.usage,
		durationMs: details.durationMs,
		lastEventAt: at,
	};
}

export function createSubagentRoster(options: SubagentRosterOptions): SubagentRosterRegistry {
	const now = options.now ?? Date.now;
	const intervalMs = options.intervalMs ?? ROSTER_PUBLISH_INTERVAL_MS;
	const doneTtlMs = options.doneTtlMs ?? ROSTER_DONE_TTL_MS;
	const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimer =
		options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	const rows = new Map<string, SubagentRosterRow>();
	const finishedAt = new Map<string, number>();
	let revision = 0;
	let timer: unknown;
	let lastPublish = Number.NEGATIVE_INFINITY;
	let disposed = false;

	function changed(): void {
		revision++;
		if (disposed || timer !== undefined) return;
		const wait = Math.max(0, lastPublish + intervalMs - now());
		timer = setTimer(() => {
			timer = undefined;
			lastPublish = now();
			if (!disposed) publisher({ workspaceId: options.workspaceId });
		}, wait);
	}

	function upsertFromService(
		sessionId: string,
		parentSessionId: string,
	): SubagentRosterRow | undefined {
		const existing = rows.get(sessionId);
		if (existing) return existing;
		const child = options.service.findChild(sessionId);
		if (!child || child.record.visibility === "hidden") return undefined;
		if (child.record.scope !== options.workspaceId) return undefined;
		const snapshot = child.snapshot;
		const row: SubagentRosterRow = {
			childSessionId: sessionId,
			parentSessionId,
			parentTitle: options.titleOf(parentSessionId),
			...(child.record.info.roleName !== undefined
				? { roleName: child.record.info.roleName.slice(0, 200) }
				: {}),
			task: (snapshot?.task ?? "").slice(0, 2000),
			status: snapshot?.status ?? "queued",
			createdAt: child.record.createdAt,
			...(child.record.info.detached === true ? { detached: true } : {}),
		};
		rows.set(sessionId, row);
		return snapshot ? applyDetails(row, snapshot.details, now()) : row;
	}

	function prune(): void {
		const at = now();
		const terminal: [string, number][] = [];
		for (const [id, row] of rows) {
			if (isLive(row)) continue;
			const done = finishedAt.get(id) ?? at;
			if (!isFailure(row) && at - done > doneTtlMs) {
				rows.delete(id);
				finishedAt.delete(id);
			} else terminal.push([id, done]);
		}
		if (terminal.length <= ROSTER_MAX_TERMINAL_ROWS) return;
		terminal.sort((a, b) => {
			const af = isFailure(rows.get(a[0]) as SubagentRosterRow) ? 1 : 0;
			const bf = isFailure(rows.get(b[0]) as SubagentRosterRow) ? 1 : 0;
			return af - bf || a[1] - b[1];
		});
		for (const [id] of terminal.slice(0, terminal.length - ROSTER_MAX_TERMINAL_ROWS)) {
			rows.delete(id);
			finishedAt.delete(id);
		}
	}

	return {
		handle(event) {
			if (disposed) return;
			if (event.type === "child-created") return;
			if (event.type === "child-disposed") {
				const row = rows.get(event.sessionId);
				if (row && isLive(row)) {
					rows.delete(event.sessionId);
					changed();
				}
				return;
			}
			const base = upsertFromService(event.sessionId, event.parentSessionId);
			if (!base) return;
			const at = now();
			let next = base;
			if (event.type === "run-progress") next = applyDetails(base, event.details, at);
			else if (event.type === "run-terminal") {
				next = applyDetails(base, event.outcome.details, at);
				next = {
					...next,
					status: event.outcome.status,
					finishedAt: at,
					...(event.outcome.finalText !== undefined
						? { finalText: event.outcome.finalText.slice(0, 2000) }
						: {}),
					...(event.outcome.errorMessage !== undefined
						? { errorMessage: event.outcome.errorMessage.slice(0, 1000) }
						: {}),
				};
				finishedAt.set(event.sessionId, at);
			} else {
				next = {
					...base,
					status: event.type === "run-started" ? "running" : "queued",
					lastEventAt: at,
				};
			}
			rows.set(event.sessionId, next);
			changed();
		},
		read() {
			prune();
			const sorted = [...rows.values()].sort(
				(a, b) =>
					Number(isLive(b)) - Number(isLive(a)) ||
					Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
					(a.childSessionId < b.childSessionId ? -1 : 1),
			);
			const counts: SubagentRosterCounts = {
				queued: 0,
				running: 0,
				failed: 0,
				done: 0,
				stopped: 0,
			};
			for (const row of sorted) {
				if (row.status === "queued") counts.queued++;
				else if (row.status === "running") counts.running++;
				else if (row.status === "error") counts.failed++;
				else if (row.status === "completed") counts.done++;
				else counts.stopped++;
			}
			return { workspaceId: options.workspaceId, revision, rows: sorted, counts };
		},
		dispose() {
			disposed = true;
			if (timer !== undefined) clearTimer(timer);
			timer = undefined;
			rows.clear();
			finishedAt.clear();
		},
	};
}

export function publishSubagentRosterChanged(workspaceId: string): void {
	publisher({ workspaceId });
}
