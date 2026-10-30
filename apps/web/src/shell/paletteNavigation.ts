import type { Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { createLatestOperation } from "../panels/latestOperation";
import { selectNavigationMarker, selectWorkspaceById, toast, useAppStore } from "../store";
import { errorText } from "../transport";

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

	const beginPick = (): (() => boolean) => {
		const isLatest = picks.begin();
		const marker = selectNavigationMarker(useAppStore.getState());
		return () => isLatest() && selectNavigationMarker(useAppStore.getState()) === marker;
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
