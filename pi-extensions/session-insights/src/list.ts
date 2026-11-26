import {
	type Figure,
	type IndexState,
	type ListProject,
	METRIC_SOURCES,
	SESSION_INSIGHTS_API_VERSION,
	type SessionListRow,
	type SessionOutcome,
	type SessionParams,
	type SessionSummaryResult,
	type SessionsListParams,
	type SessionsListResult,
} from "./core.ts";
import type { SessionIndex } from "./sessionIndex.ts";
import { joinSubagents, type SubagentJoin } from "./subagents.ts";
import type { SessionSummary } from "./summary.ts";
import { costOrigin, isRecord, tokenTotals } from "./totals.ts";

export interface SessionPlacement {
	projectId: string | null;
	workspaceId: string | null;
	workspaceName: string | null;
	workspace: "open" | "removed" | "none";
}

export interface SessionsListInput {
	index: SessionIndex;
	projects: readonly ListProject[];
	place(cwd: string): SessionPlacement | null;
	status(sessionId: string): { live: boolean; outcome: SessionOutcome | null };
}

const PROMPT_READS = 16;
const SESSION_ID_MAX = 200;

export function parseSessionParams(value: unknown, method: string): SessionParams {
	if (isRecord(value)) {
		const { sessionId } = value;
		if (typeof sessionId === "string" && sessionId.length > 0 && sessionId.length <= SESSION_ID_MAX)
			return { sessionId };
	}
	throw new Error(`Invalid ${method} params`);
}

/** `{ scope, fresh? }`: `fresh: true` asks the index to revalidate now (mount and Refresh). */
export function parseSessionsListParams(value: unknown): SessionsListParams {
	if (
		isRecord(value) &&
		isRecord(value.scope) &&
		(value.fresh === undefined || typeof value.fresh === "boolean")
	) {
		const { kind, projectId } = value.scope;
		const fresh = value.fresh === true ? { fresh: true } : {};
		if (kind === "all") return { scope: { kind: "all" }, ...fresh };
		if (kind === "project" && typeof projectId === "string" && projectId.length > 0)
			return { scope: { kind: "project", projectId }, ...fresh };
	}
	throw new Error("Invalid sessions.list params");
}

type PlacedRow = Omit<SessionListRow, "firstPrompt">;

function rowOf(
	summary: SessionSummary,
	placement: SessionPlacement,
	children: readonly SessionSummary[],
	status: { live: boolean; outcome: SessionOutcome | null },
): PlacedRow {
	const { spend, counts } = summary;
	const join = joinSubagents(summary, children);
	const unmeasured = !join.measured || (placement.workspace === "removed" && join.count > 0);
	const start: Figure =
		summary.start === null
			? { value: null, origin: "notRecorded" }
			: { value: summary.start, origin: "counted" };
	return {
		sessionId: summary.sessionId,
		projectId: placement.projectId,
		workspaceId: placement.workspaceId,
		workspaceName: placement.workspaceName,
		workspaceState: placement.workspace,
		title: summary.title,
		live: status.live,
		outcome: status.outcome,
		start,
		activeMs: { value: summary.activeMs, origin: "approximated" },
		tokens: { value: tokenTotals(spend), origin: "recorded" },
		cost: { value: spend.cost, origin: costOrigin(spend) },
		subagentsOutside: { value: join.outside, origin: unmeasured ? "notMeasured" : "recorded" },
		toolCalls: { value: counts.toolCalls, origin: "counted" },
		toolErrors: { value: counts.toolErrors, origin: "counted" },
		subagents: { value: join.count, origin: unmeasured ? "notMeasured" : "counted" },
		models: Object.keys(summary.models),
	};
}

function byStartThenId(a: PlacedRow, b: PlacedRow): number {
	const left = a.start.value;
	const right = b.start.value;
	if (left !== right) {
		if (left === null) return 1;
		if (right === null) return -1;
		return right - left;
	}
	return a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0;
}

function childrenOf(index: SessionIndex, sessionId: string): SessionSummary[] {
	return index.childFiles(sessionId).flatMap((file) => index.childSummary(file) ?? []);
}

/** The transcripts in an indexed session's child directories, by child id (the first file of an id). */
export function childTranscriptsOf(
	index: SessionIndex,
	sessionId: string,
): Map<string, { childId: string; file: string; spend: SessionSummary["spend"] | null }> {
	const out = new Map<
		string,
		{ childId: string; file: string; spend: SessionSummary["spend"] | null }
	>();
	for (const file of index.childFiles(sessionId)) {
		const child = index.childSummary(file);
		if (!child || child.sessionId === sessionId || out.has(child.sessionId)) continue;
		out.set(child.sessionId, {
			childId: child.sessionId,
			file,
			spend: child.parentSession === null ? child.spend : null,
		});
	}
	return out;
}

/** The subagent join of an indexed session, `null` when the index has no such session. */
export function subagentJoinOf(index: SessionIndex, sessionId: string): SubagentJoin | null {
	const summary = index.summaryOf(sessionId);
	return summary ? joinSubagents(summary, childrenOf(index, sessionId)) : null;
}

async function withPrompts(
	index: SessionIndex,
	rows: readonly PlacedRow[],
): Promise<SessionListRow[]> {
	const prompts: (string | null)[] = new Array(rows.length).fill(null);
	let next = 0;
	const worker = async () => {
		while (next < rows.length) {
			const at = next++;
			const row = rows[at];
			if (row) prompts[at] = await index.firstPrompt(row.sessionId);
		}
	};
	await Promise.all(Array.from({ length: Math.min(PROMPT_READS, rows.length) }, worker));
	return rows.map((row, at) => ({ ...row, firstPrompt: prompts[at] ?? null }));
}

export function projectsOf(
	projects: readonly ListProject[],
	rows: readonly PlacedRow[],
): readonly ListProject[] {
	const latest = new Map<string, number>();
	for (const row of rows) {
		if (row.projectId === null || latest.has(row.projectId)) continue;
		latest.set(row.projectId, row.start.value ?? Number.NEGATIVE_INFINITY);
	}
	return projects
		.map((project, order) => ({ project, order, start: latest.get(project.id) }))
		.filter(
			(item): item is { project: ListProject; order: number; start: number } =>
				item.start !== undefined,
		)
		.sort((a, b) => b.start - a.start || a.order - b.order)
		.map(({ project }) => ({ id: project.id, name: project.name, kind: project.kind }));
}

/** Indexed sessions the embedder places in scope, each id once (the first file listed), unsorted. */
export function placedSummaries(
	input: SessionsListInput,
): { summary: SessionSummary; placement: SessionPlacement }[] {
	const out: { summary: SessionSummary; placement: SessionPlacement }[] = [];
	const seen = new Set<string>();
	for (const summary of input.index.summaries()) {
		if (seen.has(summary.sessionId)) continue;
		seen.add(summary.sessionId);
		const placement = input.place(summary.cwd);
		if (placement) out.push({ summary, placement });
	}
	return out;
}

/** List rows for the placed sessions `keep` accepts, start descending, with their first prompts. */
export async function listRows(
	input: SessionsListInput,
	keep: (summary: SessionSummary) => boolean = () => true,
): Promise<SessionListRow[]> {
	const { index } = input;
	const placed = placedSummaries(input)
		.filter(({ summary }) => keep(summary))
		.map(({ summary, placement }) =>
			rowOf(
				summary,
				placement,
				childrenOf(index, summary.sessionId),
				input.status(summary.sessionId),
			),
		);
	placed.sort(byStartThenId);
	return withPrompts(index, placed);
}

export async function buildSessionsList(
	input: SessionsListInput,
	state: IndexState,
): Promise<SessionsListResult> {
	const rows = await listRows(input);
	return {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		state,
		projects: projectsOf(input.projects, rows),
		rows,
		sources: METRIC_SOURCES,
	};
}

/** One session's header: its list row plus the project name and wall time. */
export async function buildSessionSummary(
	input: SessionsListInput,
	state: IndexState,
	sessionId: string,
): Promise<SessionSummaryResult> {
	const { index } = input;
	const summary = index.summaryOf(sessionId);
	const placement = summary ? input.place(summary.cwd) : null;
	if (!summary || !placement)
		return {
			apiVersion: SESSION_INSIGHTS_API_VERSION,
			state,
			session: null,
			pending: !summary && state.phase !== "ready",
			sources: METRIC_SOURCES,
		};
	const row = rowOf(summary, placement, childrenOf(index, sessionId), input.status(sessionId));
	const [withPrompt] = await withPrompts(index, [row]);
	const project = input.projects.find((candidate) => candidate.id === placement.projectId);
	const wall: Figure =
		summary.start === null || summary.end === null
			? { value: null, origin: "notRecorded" }
			: { value: Math.max(0, summary.end - summary.start), origin: "counted" };
	return {
		apiVersion: SESSION_INSIGHTS_API_VERSION,
		state,
		session: withPrompt
			? { ...withPrompt, projectName: project?.name ?? null, wallMs: wall }
			: null,
		pending: false,
		sources: METRIC_SOURCES,
	};
}
