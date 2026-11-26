import { currentTranslator } from "@thinkrail/locales/react";
import { useSyncExternalStore } from "react";
import { matchKeybinding } from "../keybindings";
import { RECENT_SWITCHER_TEST_ID, RecentSwitcher, recentWorkspaces } from "../search";
import { useAppStore } from "../store";
import { claimKeyboard } from "./extensionCommands";
import { currentKeybindings, useKeybindingKeys } from "./keybindingState";
import { createRecentSwitcher } from "./recentSwitcher";
import { currentWorkItems, watchWorkspaceBackfill } from "./workItemsSource";

const CLAIM = "recent-switcher";

type AppState = ReturnType<typeof useAppStore.getState>;

function rowsChanged(state: AppState, previous: AppState): boolean {
	return (
		state.projects !== previous.projects ||
		state.workspaces !== previous.workspaces ||
		state.sessionStateByWorkspace !== previous.sessionStateByWorkspace ||
		state.activeWorkspaceId !== previous.activeWorkspaceId
	);
}

export const recentSwitcher = createRecentSwitcher({
	load: () => recentWorkspaces(currentWorkItems(currentTranslator()), useAppStore.getState()),
	chordStep: (event) => {
		const id = matchKeybinding(currentKeybindings(), event);
		return id === "workspace.recentNext" ? 1 : id === "workspace.recentPrevious" ? -1 : null;
	},
	watch: (onChange) => {
		const stopBackfill = watchWorkspaceBackfill();
		const unsubscribe = useAppStore.subscribe((state, previous) => {
			if (rowsChanged(state, previous)) onChange();
		});
		return () => {
			unsubscribe();
			stopBackfill();
		};
	},
	claimKeyboard: (active) => claimKeyboard(CLAIM, active),
	isInside: (target) =>
		target instanceof Element &&
		target.closest(`[data-testid="${RECENT_SWITCHER_TEST_ID}"]`) !== null,
	target: () => window,
	schedule: (run, ms) => {
		const timer = setTimeout(run, ms);
		return () => clearTimeout(timer);
	},
});

export function RecentSwitcherHost() {
	const snapshot = useSyncExternalStore(recentSwitcher.subscribe, recentSwitcher.getSnapshot);
	const nextKeys = useKeybindingKeys("workspace.recentNext");
	if (!snapshot.visible) return null;
	return (
		<RecentSwitcher
			rows={snapshot.rows}
			selectedIndex={snapshot.index}
			currentId={snapshot.currentId}
			nextKeys={nextKeys}
			onHover={recentSwitcher.hover}
			onActivate={recentSwitcher.activate}
		/>
	);
}
