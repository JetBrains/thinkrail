import { FOCUS_GROUP_BINDINGS, type KeybindingId } from "../keybindings";
import { openChatInTab } from "../panels/openChat";
import { SETTING_ATTR } from "../settingsKit";
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
import {
	activeLayer,
	hasDismissibleLayer,
	isInTerminal,
	type LayerDocument,
} from "./shortcutLayers";
import { runActiveTabAction } from "./workbenchCommands";

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
	const attended = (current: typeof state) =>
		selectChatAttended(current, workspaceId, sessionId, { ignoreHistory: true });
	if (!attended(state)) void openChatInTab(workspaceId, sessionId);
	whenSettled(
		() => (attended(useAppStore.getState()) ? target : null),
		() =>
			useAppStore.getState().requestComposerFocus(workspaceId, sessionId, { dismissHistory: true }),
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

const ACTIVE_FILE_ROW = '[role="treeitem"][aria-current="true"]';

export function showFiles(mode: "all" | "changed", { activeRow = false } = {}): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (!workspaceId) return;
	state.setFilesMode(mode);
	state.requestToolView(workspaceId, "files");
	focusToolBody(
		"files",
		(body) => body.querySelector(`[data-files-mode="${mode}"]`) !== null,
		activeRow ? ACTIVE_FILE_ROW : undefined,
	);
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

function dismissTopLayer(): boolean {
	const doc = globalThis.document;
	if (!hasDismissibleLayer(doc)) return false;
	(doc.activeElement ?? doc.body ?? doc).dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Escape",
			code: "Escape",
			bubbles: true,
			cancelable: true,
		}),
	);
	return true;
}

const SETTINGS_LAYER_SELECTOR = `[${SETTING_ATTR.dialog}][data-state="open"]`;

export function settingsLayer(doc: Pick<ParentNode, "querySelector">): Element | null {
	return doc.querySelector(SETTINGS_LAYER_SELECTOR);
}

export function closesSettings(doc: LayerDocument & ParentNode): boolean {
	const settings = settingsLayer(doc);
	if (settings === null) return false;
	return activeLayer(doc) === settings || settings.contains(doc.activeElement);
}

function closeSettingsAtOnce(): boolean {
	const doc = globalThis.document;
	if (!closesSettings(doc)) return false;
	const active = doc.activeElement;
	if (active instanceof HTMLElement && settingsLayer(doc)?.contains(active)) active.blur();
	useAppStore.getState().closeSettings();
	return true;
}

export function closeActiveItem(): void {
	if (closeSettingsAtOnce()) return;
	if (!dismissTopLayer()) runActiveTabAction("tab.close");
}
