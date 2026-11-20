import { awaitingToolCallIdOf } from "@thinkrail/chat-ui/interactionState";
import type { ExtUiDialogRequest } from "@thinkrail/chat-ui/types";
import type { SessionState } from "@thinkrail/contracts";

/** What a chat lets this phone answer: nothing at all when its computer made it read-only. */
export interface ChatAccess {
	/** The call the agent waits on, `null` when no card accepts an answer. */
	awaitingToolCallId: string | null | undefined;
	pendingExtUi: ExtUiDialogRequest | null;
	canTryAgain: boolean;
}

export function chatAccess({
	readOnly,
	hostState,
	pendingExtUi,
	isStreaming,
}: {
	readOnly: boolean;
	hostState: SessionState | null;
	pendingExtUi: ExtUiDialogRequest | null;
	isStreaming: boolean;
}): ChatAccess {
	if (readOnly) return { awaitingToolCallId: null, pendingExtUi: null, canTryAgain: false };
	return {
		awaitingToolCallId: awaitingToolCallIdOf(hostState),
		pendingExtUi,
		canTryAgain: !isStreaming,
	};
}
