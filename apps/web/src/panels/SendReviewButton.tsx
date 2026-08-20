import { Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import { allDraftIds, fileDraftIds } from "./reviewModel";
import { sendReviewBatch } from "./reviewSend";

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

export function SendAllReviewsButton({ workspaceId }: { workspaceId: string }) {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const count = useMemo(() => allDraftIds(comments).length, [comments]);
	return (
		<SendButtonBase
			testid="review-send-all"
			label={`Send all (${count})`}
			count={count}
			send={() => sendReviewBatch(workspaceId)}
		/>
	);
}

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
			className="flex h-6 shrink-0 items-center gap-xs rounded-[var(--radius-sm)] bg-control-primary-bg px-sm text-control-primary-text tr-text-action transition-colors hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
		>
			<Send className="size-3" />
			{label}
		</button>
	);
}
