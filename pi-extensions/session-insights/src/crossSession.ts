import type {
	DigestProgress,
	IndexState,
	SessionListRow,
	SessionRef,
	StatsParams,
} from "./core.ts";
import type { DigestStore, SessionDigest } from "./digest.ts";
import {
	listRows,
	parseSessionsListParams,
	type SessionsListInput,
	subagentJoinOf,
} from "./list.ts";
import type { SubagentJoin } from "./subagents.ts";
import type { SessionSummary } from "./summary.ts";
import type { ContextWindowLookup } from "./timeline.ts";

/** What a statistics query reads: the list's input plus the digests and host lookups. */
export interface StatsInput extends SessionsListInput {
	digests: DigestStore;
	contextWindow?: ContextWindowLookup;
	/** How long a query waits for missing digests before answering with what is built. */
	budgetMs?: number;
	/** The user's labels of a session (the embedder's store); none when omitted. */
	labelsOf?: (sessionId: string) => readonly string[];
}

/** A session in scope with a digest (its file's latest), at its index in the result's `sessions`. */
export interface ScopedSession {
	index: number;
	row: SessionListRow;
	summary: SessionSummary;
	digest: SessionDigest;
	join: SubagentJoin | null;
}

export interface StatsScope {
	state: IndexState;
	sessions: SessionRef[];
	ready: ScopedSession[];
	progress: DigestProgress;
}

const BUDGET_MS = 150;

/** `{ scope }` params of `stats.usage` and `findings.list`. */
export function parseStatsParams(value: unknown, method: string): StatsParams {
	try {
		return { scope: parseSessionsListParams(value).scope };
	} catch {
		throw new Error(`Invalid ${method} params`);
	}
}

export function refOf(row: SessionListRow): SessionRef {
	return {
		sessionId: row.sessionId,
		title: row.title,
		firstPrompt: row.firstPrompt,
		start: row.start.value,
		projectId: row.projectId,
		workspaceId: row.workspaceId,
		workspaceState: row.workspaceState,
	};
}

/**
 * The scope's sessions (the list's rows, start descending) and their files' latest digests (a growing
 * file's previous revision while its new one is built); missing ones are queued newest first and waited
 * for up to the budget.
 */
export async function statsScope(input: StatsInput, state: IndexState): Promise<StatsScope> {
	const rows = await listRows(input);
	const summaries: SessionSummary[] = [];
	const placed: { row: SessionListRow; summary: SessionSummary; index: number }[] = [];
	rows.forEach((row, index) => {
		const summary = input.index.summaryOf(row.sessionId);
		if (!summary) return;
		summaries.push(summary);
		placed.push({ row, summary, index });
	});
	const progress = await input.digests.ensure(summaries, input.budgetMs ?? BUDGET_MS);
	const ready: ScopedSession[] = [];
	for (const { row, summary, index } of placed) {
		const digest = input.digests.latest(summary);
		if (digest)
			ready.push({
				index,
				row,
				summary,
				digest,
				join: subagentJoinOf(input.index, row.sessionId),
			});
	}
	return { state, sessions: rows.map(refOf), ready, progress };
}
