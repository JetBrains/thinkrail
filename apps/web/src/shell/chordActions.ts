import { FOCUS_GROUP_BINDINGS, type KeybindingId } from "../keybindings";
import { openChatInTab } from "../panels/openChat";
import { selectChatAttended, selectHistoryTarget, useAppStore } from "../store";
import {
	focusCenterRegion,
	focusPreviousRegion,
	focusRegionOfKind,
	focusToolBody,
	focusWhenSettled,
	terminalTarget,
	whenSettled,
} from "./regions";
import { isInTerminal } from "./shortcutLayers";

export function toggleLeftSide(toggleProjectsHome: () => void): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) state.enqueueLayoutIntent({ kind: "toggle-side", workspaceId, side: "left" });
	else toggleProjectsHome();
}

export function toggleRightSide(): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) state.enqueueLayoutIntent({ kind: "toggle-side", workspaceId, side: "right" });
}

export function toggleBottomPanel(): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) state.enqueueLayoutIntent({ kind: "toggle-bottom", workspaceId });
}

export function openChatHistory(): void {
	const state = useAppStore.getState();
	const target = selectHistoryTarget(state);
	if (target) state.requestHistoryOpen(target);
}

export function focusChatComposer(): void {
	const state = useAppStore.getState();
	const target = selectHistoryTarget(state);
	if (!target) return;
	const { workspaceId, sessionId } = target;
	if (!selectChatAttended(state, workspaceId, sessionId))
		void openChatInTab(workspaceId, sessionId);
	whenSettled(
		() => (selectChatAttended(useAppStore.getState(), workspaceId, sessionId) ? target : null),
		() => useAppStore.getState().requestComposerFocus(workspaceId, sessionId),
	);
}

const GROUP_INDEX = new Map<KeybindingId, number>(
	FOCUS_GROUP_BINDINGS.map((binding, index) => [binding, index]),
);

export function focusCenterGroup(binding: KeybindingId): void {
	const index = GROUP_INDEX.get(binding);
	if (index !== undefined) focusCenterRegion(index);
}

export function focusProjects(toggleProjectsHome: () => void): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) {
		state.requestToolView(workspaceId, "projects");
		focusToolBody("projects");
		return;
	}
	const home = document.querySelector('[data-region-kind="home"]');
	if (!home) return;
	if (home.closest("[inert]")) toggleProjectsHome();
	focusRegionOfKind("home");
}

export function showFiles(mode: "all" | "changed"): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (!workspaceId) return;
	state.setFilesMode(mode);
	state.requestToolView(workspaceId, "files");
	focusToolBody("files");
}

export function focusTerminal(): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (!workspaceId) return;
	if (isInTerminal(document.activeElement)) {
		if (!focusPreviousRegion()) focusCenterRegion(0);
		return;
	}
	const tabKey =
		state.activeTerminalByWorkspace[workspaceId] ??
		state.terminalsByWorkspace[workspaceId]?.at(-1)?.tabKey ??
		null;
	if (!terminalTarget(tabKey)) {
		if (tabKey === null) state.addTerminal(workspaceId);
		else state.setActiveTerminalTab(workspaceId, tabKey);
	}
	const target = useAppStore.getState().activeTerminalByWorkspace[workspaceId] ?? tabKey;
	focusWhenSettled(() => terminalTarget(target));
}
