import type { ExtUiDialogRequest } from "@thinkrail/chat-ui/types";
import type { SessionState } from "@thinkrail/contracts";

/** The extension dialog the host is waiting on, unless the phone has just answered it. */
export function phoneDialog(
	state: SessionState | undefined,
	answeredId: string | null,
): ExtUiDialogRequest | null {
	const needsInput = state?.needsInput;
	if (needsInput?.kind !== "dialog" || needsInput.request.id === answeredId) return null;
	return needsInput.request;
}
