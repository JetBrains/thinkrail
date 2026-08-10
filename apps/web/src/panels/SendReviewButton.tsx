import { Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import { allDraftIds, fileDraftIds } from "./reviewModel";
import { sendReviewBatch } from "./reviewSend";

/**
 * The pane-header "Send review (N)" text button — PER-FILE, matching the per-file review chat: it
 * renders only while THIS file has pending drafts, counts exactly them, and sends exactly them into
 * the file's chat, which opens immediately (the host fires the package into the session detached).
 * Other files' drafts stay put — each pane carries its own button. Shared by `FilePane`, `DiffPane`,
 * and the Review panel's unfolded section strip (`testid` keeps the sidebar's copy distinguishable in
 * tests; `path: null` is the panel's anchorless whole-change-set bucket, which the panes never show).
 */
export function SendReviewButton({
	workspaceId,
	path,
	testid = "send-review-button",
}: {
	workspaceId: string;
	path: string | null;
	testid?: string;
}) {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	// Strictly drafts: a file whose comments are all sent is still in review (the tab keeps its muted
	// flag) but has nothing left to send, so offering the action would be a lie.
	const draftIds = useMemo(() => fileDraftIds(comments, path), [comments, path]);
	return (
		<SendButtonBase
			testid={testid}
			label={`Send review (${draftIds.length})`}
			count={draftIds.length}
			send={() => sendReviewBatch(workspaceId, draftIds)}
		/>
	);
}

/**
 * The Review panel's files-level "Send all (N)": every pending draft across every file, batched by
 * the host into per-file review chats (each opens; the first takes focus). Same drafts-only gate as
 * the per-file button — it renders only while something is actually sendable.
 */
export function SendAllReviewsButton({ workspaceId }: { workspaceId: string }) {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const count = useMemo(() => allDraftIds(comments).length, [comments]);
	return (
		<SendButtonBase
			testid="review-send-all"
			label={`Send all (${count})`}
			count={count}
			// No ids: the host's "all drafts" IS the batch, so the count can't race a concurrent edit.
			send={() => sendReviewBatch(workspaceId)}
		/>
	);
}

/** The one primary send-action rendering both buttons share (icon + label + busy gate). */
function SendButtonBase({
	testid,
	label,
	count,
	send,
}: {
	testid: string;
	label: string;
	count: number;
	send: () => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	if (count === 0) return null;
	const run = async () => {
		setBusy(true);
		try {
			await send();
		} catch {
			// reported by the reviewSend helper
		} finally {
			setBusy(false);
		}
	};
	return (
		<button
			type="button"
			data-testid={testid}
			disabled={busy}
			onClick={() => void run()}
			className="flex h-6 shrink-0 items-center gap-xs rounded-[var(--radius-md)] bg-primary px-sm text-text-on-primary tr-text-action transition-opacity hover:opacity-90 disabled:opacity-50"
		>
			<Send className="size-3" />
			{label}
		</button>
	);
}
