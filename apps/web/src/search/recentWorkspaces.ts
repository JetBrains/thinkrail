import { isChatWorkspace, type useAppStore } from "../store";
import type { PaletteItem } from "./model";
import { readLearning } from "./preferences";

type AppState = ReturnType<typeof useAppStore.getState>;

export type RecentWorkspacesState = Pick<
	AppState,
	"activeWorkspaceId" | "workspaces" | "sessionStateByWorkspace"
>;

export const RECENT_WORKSPACE_LIMIT = 10;

export interface RecentWorkspaces {
	readonly rows: readonly PaletteItem[];
	readonly currentId: string | null;
}

export function rankRecentWorkspaces(
	items: readonly PaletteItem[],
	state: RecentWorkspacesState,
	lastUsed: Readonly<Record<string, number>>,
): RecentWorkspaces {
	const byId = new Map(items.map((item) => [item.id, item]));
	const ranked: { item: PaletteItem; usedAt: number }[] = [];
	let currentId: string | null = null;
	for (const list of Object.values(state.workspaces)) {
		for (const workspace of list) {
			if (workspace.deletionPending === true) continue;
			const sessions = Object.keys(state.sessionStateByWorkspace[workspace.id] ?? {});
			const stamps = [
				lastUsed[`workspace:${workspace.id}`],
				...sessions.map((sessionId) => lastUsed[`chat:${sessionId}`]),
			].filter((stamp): stamp is number => stamp !== undefined);
			const current = workspace.id === state.activeWorkspaceId;
			if (stamps.length === 0 && !current) continue;
			const item = isChatWorkspace(workspace)
				? sessions.map((sessionId) => byId.get(`chat:${sessionId}`)).find((row) => row)
				: byId.get(`workspace:${workspace.id}`);
			if (!item) continue;
			if (current) currentId = item.id;
			ranked.push({ item, usedAt: current ? Number.POSITIVE_INFINITY : Math.max(...stamps) });
		}
	}
	ranked.sort((a, b) => b.usedAt - a.usedAt);
	return {
		rows: ranked.slice(0, RECENT_WORKSPACE_LIMIT).map((entry) => entry.item),
		currentId,
	};
}

export function recentWorkspaces(
	items: readonly PaletteItem[],
	state: RecentWorkspacesState,
): RecentWorkspaces {
	return rankRecentWorkspaces(items, state, readLearning().lastUsed);
}
