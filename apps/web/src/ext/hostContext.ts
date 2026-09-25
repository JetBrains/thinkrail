import type { ExtActionContext, HostContext } from "@thinkrail/contracts";
import { useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import {
	selectActiveWorkspaceProjectId,
	selectAttentionCenterTab,
	selectHistoryTarget,
	useAppStore,
} from "../store";
import { onThemeSwap } from "../themes";

type HostIdsState = Parameters<typeof selectActiveWorkspaceProjectId>[0] &
	Parameters<typeof selectAttentionCenterTab>[0] &
	Parameters<typeof selectHistoryTarget>[0];

const readAppearance = (): HostContext["theme"] =>
	typeof document !== "undefined" && document.documentElement.dataset.themeAppearance === "light"
		? "light"
		: "dark";

const useThemeAppearance = () => useSyncExternalStore(onThemeSwap, readAppearance, readAppearance);

export const selectHostIds = (state: HostIdsState): ExtActionContext => {
	const workspaceId = state.activeWorkspaceId;
	const projectId = selectActiveWorkspaceProjectId(state);
	const tab = workspaceId ? selectAttentionCenterTab(state, workspaceId) : null;
	const sessionId = tab?.kind === "chat" ? tab.sessionId : selectHistoryTarget(state)?.sessionId;
	return {
		...(projectId ? { projectId } : {}),
		...(workspaceId ? { workspaceId } : {}),
		...(sessionId ? { sessionId } : {}),
	};
};

export const readActionContext = () => selectHostIds(useAppStore.getState());

export const useHostContext = () => {
	const ids = useAppStore(useShallow(selectHostIds));
	const theme = useThemeAppearance();
	return useMemo((): HostContext => ({ ...ids, theme }), [ids, theme]);
};
