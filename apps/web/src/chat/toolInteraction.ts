import type {
	ToolInteraction,
	ToolInteractionState,
	ToolPlacement,
} from "@thinkrail/extension-api/web";
import { useMemo } from "react";
import { useAppStore } from "@/store";
import { useChatActions } from "./ChatActions";
import { useFoldGeometry } from "./foldState";
import {
	useInteractionAccepting,
	useInteractionDocked,
	useInteractionFocusScope,
	useInteractionState,
} from "./interactionState";
import { isInteractiveTool } from "./toolRegistry";

export function useToolInteraction(
	toolCallId: string,
	toolName: string,
	dockPlacement?: ToolPlacement,
): ToolInteraction | undefined {
	const actions = useChatActions();
	const interaction = useInteractionState(toolCallId);
	const focusScope = useInteractionFocusScope();
	const prepareLayoutChange = useFoldGeometry();
	const response = interaction?.response;
	const superseded = interaction?.superseded ?? false;
	const ended = interaction?.terminal ?? false;
	const accepting = useInteractionAccepting(toolCallId);
	const docked = useInteractionDocked(toolCallId);
	const placement = dockPlacement ?? (docked ? "stub" : undefined);
	const hostProtocol = useAppStore((store) => store.protocolVersion) ?? undefined;
	const state = useMemo<ToolInteractionState>(
		() => ({ response, superseded, ended, accepting }),
		[response, superseded, ended, accepting],
	);
	return useMemo(() => {
		if (!isInteractiveTool(toolName) || !actions || !focusScope) return undefined;
		return {
			state,
			respond: (value) => actions.respondToTool(toolCallId, value),
			focusScope,
			prepareLayoutChange,
			revealElement: actions.revealChatElement,
			cancelAutomaticReveal: actions.cancelAutomaticReveal,
			focusComposer: actions.focusComposer,
			hostProtocol,
			placement,
		};
	}, [
		actions,
		focusScope,
		hostProtocol,
		placement,
		prepareLayoutChange,
		state,
		toolCallId,
		toolName,
	]);
}
