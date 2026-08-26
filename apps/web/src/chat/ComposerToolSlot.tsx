import type { ReactNode } from "react";
import type { ComposerToolCall } from "./rows";
import { getToolRenderer } from "./toolRegistry";

export function ComposerToolSlot({
	call,
	workspaceRoot,
}: {
	call: ComposerToolCall;
	workspaceRoot?: string | undefined;
}): ReactNode {
	const Renderer = getToolRenderer(call.toolName);
	return (
		<Renderer
			toolCallId={call.toolCallId}
			toolName={call.toolName}
			args={call.args}
			result={call.result}
			status="done"
			workspaceRoot={workspaceRoot}
			streaming={false}
		/>
	);
}
