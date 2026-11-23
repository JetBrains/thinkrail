import type {
	ListProject,
	SessionListRow,
	SessionsListResult,
} from "@thinkrail/pi-session-insights/core";

export type SortKey = "start" | "active" | "tokens" | "cost" | "calls" | "errors" | "subagents";

export interface Sort {
	key: SortKey;
	direction: "asc" | "desc";
}

export const DEFAULT_SORT: Sort = { key: "start", direction: "desc" };

export interface RowGroup {
	key: string;
	project: ListProject | null;
	rows: readonly SessionListRow[];
}

const OUTSIDE = "outside";

function sortValue(row: SessionListRow, key: SortKey): number | null {
	switch (key) {
		case "start":
			return row.start.value;
		case "active":
			return row.activeMs.value;
		case "tokens":
			return row.tokens.value?.total ?? null;
		case "cost":
			return row.cost.value;
		case "calls":
			return row.toolCalls.value;
		case "errors":
			return row.toolErrors.value;
		case "subagents":
			return row.subagents.value;
	}
}

export function sortRows(rows: readonly SessionListRow[], sort: Sort): SessionListRow[] {
	const sign = sort.direction === "asc" ? 1 : -1;
	return rows
		.map((row, order) => ({ row, order, value: sortValue(row, sort.key) }))
		.sort((a, b) => {
			if (a.value !== b.value) {
				if (a.value === null) return 1;
				if (b.value === null) return -1;
				return sign * (a.value - b.value);
			}
			return a.order - b.order;
		})
		.map(({ row }) => row);
}

export function nextSort(current: Sort, key: SortKey): Sort {
	if (current.key !== key) return { key, direction: "desc" };
	return { key, direction: current.direction === "desc" ? "asc" : "desc" };
}

export function groupRows(result: SessionsListResult, sort: Sort): RowGroup[] {
	const known = new Map(result.projects.map((project) => [project.id, project]));
	const byGroup = new Map<string | null, SessionListRow[]>();
	for (const row of result.rows) {
		const key = row.projectId !== null && known.has(row.projectId) ? row.projectId : null;
		const rows = byGroup.get(key);
		if (rows) rows.push(row);
		else byGroup.set(key, [row]);
	}
	const groups: RowGroup[] = [];
	for (const project of result.projects) {
		const rows = byGroup.get(project.id);
		if (rows) groups.push({ key: `project:${project.id}`, project, rows: sortRows(rows, sort) });
	}
	const outside = byGroup.get(null);
	if (outside) groups.push({ key: OUTSIDE, project: null, rows: sortRows(outside, sort) });
	return groups;
}
