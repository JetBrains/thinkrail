import type { SubagentRosterRow } from "@thinkrail/contracts";

export type AgentGroupId = "working" | "queued" | "failed" | "done";

export interface AgentGroup {
	id: AgentGroupId;
	rows: SubagentRosterRow[];
}

export function agentGroupOf(row: SubagentRosterRow): AgentGroupId {
	switch (row.status) {
		case "running":
			return "working";
		case "queued":
			return "queued";
		case "error":
			return "failed";
		default:
			return "done";
	}
}

/** State-first order: failures lead because they are the one row the user must see. */
const ORDER: readonly AgentGroupId[] = ["failed", "working", "queued", "done"];

export function groupRoster(rows: readonly SubagentRosterRow[]): AgentGroup[] {
	const groups = new Map<AgentGroupId, SubagentRosterRow[]>();
	for (const row of rows) {
		const id = agentGroupOf(row);
		const list = groups.get(id);
		if (list) list.push(row);
		else groups.set(id, [row]);
	}
	return ORDER.flatMap((id) => {
		const list = groups.get(id);
		return list ? [{ id, rows: list }] : [];
	});
}

export function isStoppableAgent(row: SubagentRosterRow): boolean {
	return row.status === "running" || row.status === "queued";
}

export function formatAgentElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatAgentTokens(row: SubagentRosterRow): string | null {
	const u = row.usage;
	if (!u) return null;
	const total = u.input + u.output;
	if (total <= 0) return null;
	return total >= 1000 ? `${(total / 1000).toFixed(1)}k tok` : `${total} tok`;
}
