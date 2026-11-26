import type { Translator } from "@thinkrail/locales/react";
import { goToProjectHome } from "../panels/workspaceActions";
import { buildWorkItems, type PaletteItem } from "../search";
import {
	selectContextProject,
	selectHostSearchAvailable,
	selectRecordFirstPrompts,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { createPaletteBackfill } from "./paletteBackfill";
import { paletteNavigator } from "./paletteNavigation";

type WorkItemsInput = Parameters<typeof buildWorkItems>[0];

const BACKFILL_CONCURRENCY = 4;

const workspaceBackfill = createPaletteBackfill({
	listWorkspaces: (projectId) =>
		getTransport().request("workspace.list", { projectId, includeDiffStats: false }),
	concurrency: BACKFILL_CONCURRENCY,
});

/** Lists collapsed projects' workspaces while a work-item surface (palette, recent switcher) is open. */
export function watchWorkspaceBackfill(): () => void {
	return workspaceBackfill.watch();
}

/** The palette's work items, opened the way every palette pick opens: latest pick wins, then the chat input takes focus. */
export function paletteWorkItems(
	input: Omit<WorkItemsInput, "navigateToProject" | "navigateToWorkspace">,
): PaletteItem[] {
	return buildWorkItems({
		...input,
		navigateToProject: (projectId) => {
			paletteNavigator.beginPick();
			goToProjectHome(projectId);
		},
		navigateToWorkspace: (workspace, sessionId) =>
			void paletteNavigator.navigateToWorkspace(workspace, sessionId).then((opened) => {
				if (opened) useAppStore.getState().requestComposerFocus(workspace.id, sessionId);
			}),
	});
}

export function currentWorkItems(t: Translator): PaletteItem[] {
	const state = useAppStore.getState();
	return paletteWorkItems({
		t,
		state,
		contextProjectId: selectContextProject(state)?.id ?? null,
		firstPrompts: selectRecordFirstPrompts(state),
		transcriptPreviews: selectHostSearchAvailable(state),
	});
}
