import type { ToolInteraction, ToolInteractionState } from "@thinkrail/extension-api/web";
import { useMemo } from "react";
import { useChatActions } from "./ChatActions";
import { useFoldGeometry } from "./foldState";
import {
	useInteractionAccepting,
	useInteractionFocusScope,
	useInteractionState,
} from "./interactionState";
import { isInteractiveTool } from "./toolRegistry";

export function useToolInteraction(
	toolCallId: string,
	toolName: string,
): ToolInteraction | undefined {
	const actions = useChatActions();
	const interaction = useInteractionState(toolCallId);
	const focusScope = useInteractionFocusScope();
	const prepareLayoutChange = useFoldGeometry();
	const response = interaction?.response;
	const superseded = interaction?.superseded ?? false;
	const ended = interaction?.terminal ?? false;
	const accepting = useInteractionAccepting(toolCallId);
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
		};
	}, [actions, focusScope, prepareLayoutChange, state, toolCallId, toolName]);
}
