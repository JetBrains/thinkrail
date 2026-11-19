import { type Translator, t as translate, useT } from "@thinkrail/locales/react";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { RegisteredPanel } from "../extensions";
import { type ChatAction, type ChatActionTarget, chatDisplayName } from "../lib";
import {
	selectChatFirstPrompt,
	selectContextRepoProject,
	selectKnownChatTitle,
	selectPersistedChatTabs,
	selectWorkspaceById,
	useAppStore,
} from "../store";
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

export function openExtensionPanelForChat(panel: RegisteredPanel, target: ChatActionTarget): void {
	const action = panel.declaration.chatAction;
	const state = useAppStore.getState();
	const chat = selectWorkspaceById(state, target.workspaceId);
	if (!action || !chat) return;
	const host = state.activeWorkspaceId ?? chat.id;
	if (!state.activeWorkspaceId) state.activateWorkspace(chat);
	const params = action.params({
		projectId: chat.projectId,
		workspaceId: target.workspaceId,
		sessionId: target.sessionId,
	});
	const title = chatDisplayName(
		translate,
		selectKnownChatTitle(state, target.workspaceId, target.sessionId),
		selectChatFirstPrompt(state, target.workspaceId, target.sessionId),
	);
	openExtensionPanel(host, panel, params, title);
}

export function chatActionsOf(t: Translator, panels: readonly RegisteredPanel[]): ChatAction[] {
	return panels.flatMap((panel) => {
		const { chatAction, title, icon } = panel.declaration;
		if (!chatAction) return [];
		return [
			{
				id: `${panel.extension}.${panel.panel}`,
				label: t(chatAction.label ?? title),
				menuLabel: t(chatAction.menuLabel),
				icon,
				run: (target: ChatActionTarget) => openExtensionPanelForChat(panel, target),
			},
		];
	});
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
