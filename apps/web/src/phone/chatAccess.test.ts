import { expect, test } from "bun:test";
import type { ExtUiDialogRequest } from "@thinkrail/chat-ui/types";
import type { SessionState } from "@thinkrail/contracts";
import { chatAccess } from "./chatAccess";

const waiting = {
	needsInput: { kind: "tool-response", toolCallId: "ask1" },
} as unknown as SessionState;
const dialog = { id: "d1", method: "confirm", title: "Sure?" } as unknown as ExtUiDialogRequest;

test("a writable chat answers the call the agent waits on, its dialog, and offers Try again when idle", () => {
	expect(
		chatAccess({ readOnly: false, hostState: waiting, pendingExtUi: dialog, isStreaming: false }),
	).toEqual({ awaitingToolCallId: "ask1", pendingExtUi: dialog, canTryAgain: true });
	expect(
		chatAccess({ readOnly: false, hostState: null, pendingExtUi: null, isStreaming: true })
			.canTryAgain,
	).toBe(false);
});

test("a read-only chat accepts no tool answer, shows no dialog and offers no Try again", () => {
	expect(
		chatAccess({ readOnly: true, hostState: waiting, pendingExtUi: dialog, isStreaming: false }),
	).toEqual({ awaitingToolCallId: null, pendingExtUi: null, canTryAgain: false });
});
