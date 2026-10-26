import { readAskUserQuestionResult } from "@thinkrail/contracts";
import type { ToolInteraction, ToolInteractionState } from "@thinkrail/extension-api/web";
import { useMemo } from "react";
import { useAskAccepting, useAskFocusScope, useAskState } from "./askState";
import { useChatActions } from "./ChatActions";
import { useFoldGeometry } from "./foldState";

const ASK_USER_QUESTION = "ask_user_question";

export function useToolInteraction(
	toolCallId: string,
	toolName: string,
): ToolInteraction | undefined {
	const actions = useChatActions();
	const ask = useAskState(toolCallId);
	const focusScope = useAskFocusScope();
	const prepareLayoutChange = useFoldGeometry();
	const answer = ask?.answer;
	const superseded = ask?.superseded ?? false;
	const ended = ask?.terminal ?? false;
	const accepting = useAskAccepting(toolCallId);
	const state = useMemo<ToolInteractionState>(
		() => ({ response: answer, superseded, ended, accepting }),
		[answer, superseded, ended, accepting],
	);
	return useMemo(() => {
		if (toolName !== ASK_USER_QUESTION || !actions || !focusScope) return undefined;
		return {
			state,
			respond: (response) => {
				const result = readAskUserQuestionResult(response);
				if (!result) return Promise.reject(new Error("Malformed ask_user_question response"));
				return actions.answerQuestion(toolCallId, result);
			},
			focusScope,
			prepareLayoutChange,
			revealElement: actions.revealChatElement,
			cancelAutomaticReveal: actions.cancelAutomaticReveal,
			focusComposer: actions.focusComposer,
		};
	}, [actions, focusScope, prepareLayoutChange, state, toolCallId, toolName]);
}
