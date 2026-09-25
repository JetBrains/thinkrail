import type { ExtActionContext, HostContext } from "@thinkrail/contracts";
import { useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectActiveWorkspaceProjectId, selectAttentionCenterTab, useAppStore } from "../store";
import { onThemeSwap } from "../themes";

type AppState = ReturnType<typeof useAppStore.getState>;

const readAppearance = (): HostContext["theme"] =>
	typeof document !== "undefined" && document.documentElement.dataset.themeAppearance === "light"
		? "light"
		: "dark";

export const useThemeAppearance = () =>
	useSyncExternalStore(onThemeSwap, readAppearance, readAppearance);

export const selectHostIds = (state: AppState): ExtActionContext => {
	const workspaceId = state.activeWorkspaceId;
	const projectId = selectActiveWorkspaceProjectId(state);
	const tab = workspaceId ? selectAttentionCenterTab(state, workspaceId) : null;
	return {
		...(projectId ? { projectId } : {}),
		...(workspaceId ? { workspaceId } : {}),
		...(tab?.kind === "chat" ? { sessionId: tab.sessionId } : {}),
	};
};

export const readActionContext = () => selectHostIds(useAppStore.getState());

export const useHostContext = () => {
	const ids = useAppStore(useShallow(selectHostIds));
	const theme = useThemeAppearance();
	return useMemo((): HostContext => ({ ...ids, theme }), [ids, theme]);
};
