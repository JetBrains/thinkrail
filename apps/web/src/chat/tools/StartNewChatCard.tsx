import { MessageSquarePlus } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolRenderProps } from "../toolRegistry";
import { strArg } from "./toolHelpers";

/**
 * The in-transcript receipt for the host-owned `start_new_chat` handoff tool (see chat/tools/SPEC.md):
 * the new chat's title + the kickoff prompt it was started with. Deliberately passive — the new tab
 * opens and takes focus via the `session.created` store fold, so the card needs no Open action; on a
 * hydrated transcript it stays the record of what was handed off.
 */
export function StartNewChatCard({ args, status }: ToolRenderProps): ReactNode {
	const title = strArg(args, "title") || "New chat";
	const prompt = strArg(args, "prompt");
	return (
		<div className="flex items-start gap-xs tr-text-ui">
			<MessageSquarePlus
				className={`mt-0.5 size-3.5 shrink-0 ${status === "error" ? "text-feedback-error" : "text-feedback-success"}`}
			/>
			<div className="min-w-0">
				<span className="text-text-default">{title}</span>
				{status === "error" ? (
					<span className="ml-xs text-feedback-error">couldn't be started</span>
				) : (
					<span className="ml-xs text-text-muted">started</span>
				)}
				{prompt && (
					<p className="mt-1 whitespace-pre-wrap break-words text-text-subtle">{prompt}</p>
				)}
			</div>
		</div>
	);
}
