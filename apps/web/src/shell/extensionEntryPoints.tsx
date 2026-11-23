import type { Workspace } from "@thinkrail/contracts";
import { type Translator, t as translate, useT } from "@thinkrail/locales/react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { RegisteredPanel } from "../extensions";
import {
	type ChatAction,
	type ChatActionTarget,
	chatDisplayName,
	layoutResourceIdentity,
} from "../lib";
import { openChatInTab } from "../panels/openChat";
import {
	chatPaneViewKey,
	selectChatAttended,
	selectChatFirstPrompt,
	selectChatPane,
	selectChatPlacedInCenter,
	selectContextRepoProject,
	selectKnownChatTitle,
	selectPanelViewState,
	selectPersistedChatTabs,
	selectWorkspaceById,
	useAppStore,
} from "../store";
import { hideAllPanels } from "./chordActions";
import {
	openExtensionPanel,
	openExtensionPanelHere,
	useOpenableExtensionPanels,
} from "./extensionPanelHost";
import { useKeybindingKeys } from "./keybindingState";
import {
	AuxiliaryRailActionButton,
	type AuxiliaryRailControlProps,
	type AuxiliaryRailFooterItem,
	type ChatTabActions,
} from "./layout";
import { renderShortcutsRailButton } from "./ShortcutsDialog";

function openChatPanelTab(
	panel: RegisteredPanel,
	target: ChatActionTarget,
	chat: Workspace,
	params: Readonly<Record<string, string>>,
	viewState?: unknown,
): void {
	const state = useAppStore.getState();
	const host = state.activeWorkspaceId ?? chat.id;
	if (!state.activeWorkspaceId) state.activateWorkspace(chat);
	if (viewState !== undefined) {
		state.transferPanelViewState(
			host,
			layoutResourceIdentity({
				kind: "extension",
				extension: panel.extension,
				panel: panel.panel,
				params,
			}),
			viewState,
		);
	}
	const title = chatDisplayName(
		translate,
		selectKnownChatTitle(state, target.workspaceId, target.sessionId),
		selectChatFirstPrompt(state, target.workspaceId, target.sessionId),
	);
	openExtensionPanel(host, panel, params, title);
}

function openBesideChat(
	panel: RegisteredPanel,
	{ workspaceId, sessionId }: ChatActionTarget,
	params: Readonly<Record<string, string>>,
): void {
	const state = useAppStore.getState();
	if (!selectChatAttended(state, workspaceId, sessionId, { ignoreHistory: true })) {
		void openChatInTab(workspaceId, sessionId);
	}
	const current = selectChatPane(state, workspaceId, sessionId);
	if (current?.open && current.extension === panel.extension && current.panel === panel.panel) {
		return;
	}
	state.openChatPane(workspaceId, sessionId, {
		extension: panel.extension,
		panel: panel.panel,
		params,
	});
	if (panel.declaration.wide) hideAllPanels(workspaceId);
}

/** A chat panel opens beside its chat when that chat has a tab in the active workspace's center, else in a tab. */
export function openExtensionPanelForChat(panel: RegisteredPanel, target: ChatActionTarget): void {
	const action = panel.declaration.chatAction;
	const state = useAppStore.getState();
	const chat = selectWorkspaceById(state, target.workspaceId);
	if (!action || !chat) return;
	const params = action.params({
		projectId: chat.projectId,
		workspaceId: target.workspaceId,
		sessionId: target.sessionId,
	});
	if (
		panel.declaration.chatPane &&
		selectChatPlacedInCenter(state, target.workspaceId, target.sessionId)
	) {
		openBesideChat(panel, target, params);
		return;
	}
	openChatPanelTab(panel, target, chat, params);
}

/** Moves the chat's pane, with the view state it last saved, to its own center tab and closes the pane. */
export function moveChatPaneToTab(panel: RegisteredPanel, target: ChatActionTarget): void {
	const state = useAppStore.getState();
	const pane = selectChatPane(state, target.workspaceId, target.sessionId);
	const chat = selectWorkspaceById(state, target.workspaceId);
	if (!pane || !chat || pane.extension !== panel.extension || pane.panel !== panel.panel) return;
	const viewState = selectPanelViewState(
		state,
		target.workspaceId,
		chatPaneViewKey(target.sessionId, panel.extension, panel.panel),
	);
	openChatPanelTab(panel, target, chat, pane.params, viewState);
	useAppStore.getState().closeChatPane(target.workspaceId, target.sessionId);
}

export function chatActionsOf(t: Translator, panels: readonly RegisteredPanel[]): ChatAction[] {
	return panels.flatMap((panel) => {
		const { chatAction, chatPane, title, icon } = panel.declaration;
		if (!chatAction) return [];
		return [
			{
				id: chatPanelActionId(panel),
				label: t(chatAction.label ?? title),
				menuLabel: t(chatAction.menuLabel),
				icon,
				run: (target: ChatActionTarget) => openExtensionPanelForChat(panel, target),
				...(chatPane ? { pane: true as const } : {}),
			},
		];
	});
}

export function chatPanelActionId(panel: Pick<RegisteredPanel, "extension" | "panel">): string {
	return `${panel.extension}.${panel.panel}`;
}

export function useChatActions(): readonly ChatAction[] {
	const t = useT();
	const panels = useOpenableExtensionPanels();
	return useMemo(() => chatActionsOf(t, panels), [t, panels]);
}

export function useChatTabActions(
	workspaceId: string,
	actions: readonly ChatAction[],
): ChatTabActions | undefined {
	const sessions = useAppStore(useShallow((state) => selectPersistedChatTabs(state, workspaceId)));
	return useMemo(() => {
		if (actions.length === 0 || sessions.length === 0) return undefined;
		return Object.fromEntries(
			sessions.map((sessionId) => [
				sessionId,
				actions.map(({ id, menuLabel, run }) => ({
					id,
					label: menuLabel,
					run: () => run({ workspaceId, sessionId }),
				})),
			]),
		);
	}, [actions, sessions, workspaceId]);
}

function ExtensionRailButton({
	panel,
	control,
}: {
	panel: RegisteredPanel;
	control: AuxiliaryRailControlProps;
}) {
	const t = useT();
	const { rail, title, icon } = panel.declaration;
	const shortcut = useKeybindingKeys(rail?.command ?? "");
	return (
		<AuxiliaryRailActionButton
			region="left"
			icon={icon}
			label={t(rail?.label ?? title)}
			shortcut={rail?.command ? shortcut : undefined}
			testId={`extension-rail-${panel.extension}-${panel.panel}`}
			control={control}
			onClick={() => openExtensionPanelHere(panel)}
		/>
	);
}

const SHORTCUTS_FOOTER: AuxiliaryRailFooterItem = {
	key: "shortcuts",
	render: renderShortcutsRailButton,
};

export function railFooterItems(
	panels: readonly RegisteredPanel[],
	placeable: boolean,
): AuxiliaryRailFooterItem[] {
	const railed = placeable ? panels.filter((panel) => panel.declaration.rail !== undefined) : [];
	return [
		...railed.map(
			(panel): AuxiliaryRailFooterItem => ({
				key: `extension:${panel.extension}.${panel.panel}`,
				render: (control) => <ExtensionRailButton panel={panel} control={control} />,
			}),
		),
		SHORTCUTS_FOOTER,
	];
}

export function useLeftRailFooter(): readonly AuxiliaryRailFooterItem[] {
	const panels = useOpenableExtensionPanels();
	const placeable = useAppStore(
		(state) => state.activeWorkspaceId !== null || selectContextRepoProject(state) !== null,
	);
	return useMemo(() => railFooterItems(panels, placeable), [panels, placeable]);
}
