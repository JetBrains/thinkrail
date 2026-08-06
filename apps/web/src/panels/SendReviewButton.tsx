import { Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import { fileDraftIds } from "./reviewModel";
import { sendReviewBatch } from "./reviewSend";

/**
 * The pane-header "Send review (N)" text button — PER-FILE, matching the per-file review chat: it
 * renders only while THIS file has pending drafts, counts exactly them, and sends exactly them into
 * the file's chat, which opens immediately (the host fires the package into the session detached).
 * Other files' drafts stay put — each pane carries its own button. Shared by `FilePane` and
 * `DiffPane`.
 */
export function SendReviewButton({ workspaceId, path }: { workspaceId: string; path: string }) {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	// Strictly drafts: a file whose comments are all sent is still in review (the tab keeps its muted
	// flag) but has nothing left to send, so offering the action would be a lie.
	const draftIds = useMemo(() => fileDraftIds(comments, path), [comments, path]);
	const [busy, setBusy] = useState(false);
	if (draftIds.length === 0) return null;
	const send = async () => {
		setBusy(true);
		try {
			await sendReviewBatch(workspaceId, draftIds);
		} catch {
			// reported by the helper
		} finally {
			setBusy(false);
		}
	};
	return (
		<button
			type="button"
			data-testid="send-review-button"
			disabled={busy}
			onClick={() => void send()}
			className="flex h-6 shrink-0 items-center gap-xs rounded-[var(--radius-md)] bg-primary px-sm text-text-on-primary tr-text-action transition-opacity hover:opacity-90 disabled:opacity-50"
		>
			<Send className="size-3" />
			Send review ({draftIds.length})
		</button>
	);
}
