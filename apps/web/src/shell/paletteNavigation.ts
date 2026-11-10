import type { Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { createLatestOperation } from "../panels/latestOperation";
import { isNavigationChange, selectWorkspaceById, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { mergeProjectWorkspaces } from "./paletteBackfill";

type WorkspaceTarget = Pick<Workspace, "id" | "projectId">;

function openable(workspace: Workspace): boolean {
	if (workspace.deletionPending !== true) return true;
	toast.error(t("search.item.unavailable"));
	return false;
}

export function createPaletteNavigator(
	loadProjectWorkspaces: (projectId: string) => Promise<unknown>,
) {
	const picks = createLatestOperation();
	let stopWatching = () => {};

	const beginPick = (): (() => boolean) => {
		stopWatching();
		const isLatest = picks.begin();
		let overtaken = false;
		const unsubscribe = useAppStore.subscribe((state, previous) => {
			if (!isNavigationChange(state, previous)) return;
			overtaken = true;
			unsubscribe();
		});
		stopWatching = unsubscribe;
		return () => isLatest() && !overtaken;
	};

	const loadWorkspaceRow = async (workspace: WorkspaceTarget): Promise<boolean> => {
		const stillWanted = beginPick();
		const known = selectWorkspaceById(useAppStore.getState(), workspace.id);
		if (known) return openable(known);
		let failure: unknown = null;
		await loadProjectWorkspaces(workspace.projectId).catch((error: unknown) => {
			failure = error;
		});
		if (!stillWanted()) return false;
		const loaded = selectWorkspaceById(useAppStore.getState(), workspace.id);
		if (loaded) return openable(loaded);
		toast.error(
			failure === null
				? t("search.item.unavailable")
				: errorText(failure, t("search.item.openFailed")),
		);
		return false;
	};

	return {
		beginPick,
		loadWorkspaceRow,
		async navigateToWorkspace(workspace: WorkspaceTarget, sessionId?: string): Promise<boolean> {
			if (!(await loadWorkspaceRow(workspace))) return false;
			useAppStore.getState().activateWorkspaceFromRoute(workspace, sessionId);
			return true;
		},
	};
}

/** The one navigator every pick shares — palette rows, host hits and Find in Files — so a newer pick or any navigation overtakes an older one. */
export const paletteNavigator = createPaletteNavigator(async (projectId) =>
	mergeProjectWorkspaces(
		projectId,
		await getTransport().request("workspace.list", { projectId, includeDiffStats: false }),
	),
);
