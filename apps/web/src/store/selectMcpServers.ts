import type {
	McpServerScope,
	McpServerState,
	McpServerStatus,
	McpServerSummary,
} from "@thinkrail/contracts";
import { isMcpAttentionState } from "../lib";
import type { McpHeldSnapshot, McpRead, McpWorkspaceProjection } from "./mcp";
import { selectSupportsMcp } from "./selectors";

export const MCP_STARTING_BOUND_MS = 60_000;

export type McpRowState = McpServerState | "replaced";

export interface McpServerRow {
	key: string;
	summary: McpServerSummary;
	state: McpRowState;
	toolCount?: number;
	detail?: string;
	sessions: { total: number; reporting: string[]; connected: number };
	startingSince?: number;
	startingStalled: boolean;
	approvalPending: boolean;
	attention: boolean;
}

const PRECEDENCE: readonly McpServerState[] = [
	"handled-elsewhere",
	"pending-approval",
	"invalid-config",
	"needs-sign-in",
	"failed",
	"disconnected",
	"pending-reload",
	"starting",
	"connected",
	"unknown",
	"disabled-in-chat",
	"disabled-in-project",
	"disabled",
	"not-running",
];

const SCOPE_ORDER: Record<McpServerScope, number> = { user: 0, project: 1 };

function configuredState(summary: McpServerSummary): McpServerState {
	if (summary.configError) return "invalid-config";
	if (summary.scope === "project" && summary.approval?.state !== "approved") {
		return "pending-approval";
	}
	if (!summary.enabled) {
		return summary.projectOverride?.enabled === false ? "disabled-in-project" : "disabled";
	}
	return "not-running";
}

function effectiveScope(summaries: readonly McpServerSummary[]): McpServerScope {
	const project = summaries.find((summary) => summary.scope === "project");
	if (!project) return "user";
	if (!summaries.some((summary) => summary.scope === "user")) return "project";
	return project.approval?.state === "approved" && !project.configError ? "project" : "user";
}

function strongest(states: readonly McpServerState[]): McpServerState {
	return PRECEDENCE.find((state) => states.includes(state)) ?? "unknown";
}

function aggregate(
	summary: McpServerSummary,
	sessions: readonly McpHeldSnapshot[],
	now: number,
): Omit<McpServerRow, "key" | "summary" | "approvalPending" | "attention"> {
	const reports = sessions.map((held) => ({
		held,
		status: held.snapshot.servers.find((server) => server.name === summary.name),
	}));
	if (reports.every(({ status }) => status === undefined)) {
		const configured = configuredState(summary);
		return {
			state: configured === "not-running" && sessions.length > 0 ? "unknown" : configured,
			sessions: { total: sessions.length, reporting: [], connected: 0 },
			startingStalled: false,
			...(summary.configError ? { detail: summary.configError } : {}),
		};
	}
	const stateOf = (status: McpServerStatus | undefined): McpServerState =>
		status?.state ?? "unknown";
	const winner = strongest(reports.map(({ status }) => stateOf(status)));
	const matching = reports.filter(({ status }) => stateOf(status) === winner);
	const toolCounts = matching.flatMap(({ status }) =>
		status?.toolCount === undefined ? [] : [status.toolCount],
	);
	const detail = matching.find(({ status }) => status?.detail)?.status?.detail;
	const since = matching.flatMap(({ held }) => {
		const value = held.startingSince[summary.name];
		return value === undefined ? [] : [value];
	});
	const startingSince = since.length > 0 ? Math.min(...since) : undefined;
	const startingStalled =
		winner === "starting" &&
		startingSince !== undefined &&
		now - startingSince > MCP_STARTING_BOUND_MS;
	return {
		state: startingStalled ? "unknown" : winner,
		...(toolCounts.length > 0 ? { toolCount: Math.max(...toolCounts) } : {}),
		...(detail ? { detail } : {}),
		sessions: {
			total: sessions.length,
			reporting: matching.map(({ held }) => held.snapshot.sessionId),
			connected: reports.filter(({ status }) => status?.state === "connected").length,
		},
		...(startingSince !== undefined ? { startingSince } : {}),
		startingStalled,
	};
}

function rowRank(row: McpServerRow): number {
	if (row.attention) return 0;
	return row.state === "disabled" || row.state === "disabled-in-project" || row.state === "replaced"
		? 2
		: 1;
}

export function deriveMcpServerRows(
	projection: McpWorkspaceProjection | undefined,
	now: number,
): McpServerRow[] {
	const summaries = projection?.servers ?? [];
	const sessions = Object.entries(projection?.sessions ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, held]) => held);
	const rows = summaries.map((summary): McpServerRow => {
		const sameName = summaries.filter((candidate) => candidate.name === summary.name);
		const effective = effectiveScope(sameName) === summary.scope;
		const approvalPending = !!summary.approval && summary.approval.state !== "approved";
		const base = projection?.handledElsewhere
			? {
					state: "handled-elsewhere" as const,
					sessions: { total: sessions.length, reporting: [], connected: 0 },
					startingStalled: false,
				}
			: effective
				? aggregate(summary, sessions, now)
				: {
						state: summary.scope === "user" ? ("replaced" as const) : configuredState(summary),
						sessions: { total: sessions.length, reporting: [], connected: 0 },
						startingStalled: false,
						...(summary.configError ? { detail: summary.configError } : {}),
					};
		return {
			key: `${summary.scope}:${summary.name}`,
			summary,
			...base,
			approvalPending,
			attention:
				(base.state !== "replaced" && isMcpAttentionState(base.state)) ||
				(approvalPending && base.state !== "handled-elsewhere"),
		};
	});
	return rows.sort(
		(a, b) =>
			rowRank(a) - rowRank(b) ||
			a.summary.name.localeCompare(b.summary.name) ||
			SCOPE_ORDER[a.summary.scope] - SCOPE_ORDER[b.summary.scope],
	);
}

export function selectMcpRead(
	state: {
		status: string;
		protocolVersion: number | null;
		connectionGeneration: number;
		mcpRevision: number;
		removedWorkspaceIds: Record<string, true>;
	},
	workspaceId: string,
): McpRead | null {
	if (
		state.status !== "connected" ||
		!selectSupportsMcp(state) ||
		state.removedWorkspaceIds[workspaceId]
	) {
		return null;
	}
	return {
		workspaceId,
		connectionGeneration: state.connectionGeneration,
		revision: state.mcpRevision,
	};
}

export function selectMcpWorkspaceStarting(
	state: { mcpByWorkspace: Record<string, McpWorkspaceProjection> },
	workspaceId: string,
): boolean {
	return Object.values(state.mcpByWorkspace[workspaceId]?.sessions ?? {}).some((held) =>
		held.snapshot.servers.some((server) => server.state === "starting"),
	);
}
