import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolRenderProps } from "../toolRegistry";
import { strArg } from "./toolHelpers";

/**
 * The compact receipt for the host-owned `resolve_comment` review tool (see chat/tools/SPEC.md): a ✓ +
 * the resolved comment id and the agent's note. Routine — the review sidebar is where resolution state
 * lives (it converges via `review.changed`); this card is just the in-transcript trace.
 */
export function ResolveCommentCard({ args, status }: ToolRenderProps): ReactNode {
	const commentId = strArg(args, "commentId");
	const note = strArg(args, "note");
	return (
		<div className="flex items-start gap-xs tr-text-ui">
			<CheckCircle2
				className={`mt-[1px] size-3.5 shrink-0 ${status === "error" ? "text-feedback-error" : "text-feedback-success"}`}
			/>
			<div className="min-w-0">
				<span className="tr-code-text text-text-muted">{commentId}</span>
				{status === "error" ? (
					<span className="ml-xs text-feedback-error">couldn't be resolved</span>
				) : (
					<span className="ml-xs text-text-muted">resolved</span>
				)}
				{note && <p className="text-text-subtle italic">{note}</p>}
			</div>
		</div>
	);
}
