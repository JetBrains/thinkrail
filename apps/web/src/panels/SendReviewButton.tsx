import { RiSendPlaneLine as Send } from "@remixicon/react";
import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import { allDraftIds, fileDraftIds } from "./reviewModel";
import { sendReviewBatch } from "./reviewSend";

export function SendReviewButton({
	workspaceId,
	path,
	chatSessionId,
	testid = "send-review-button",
}: {
	workspaceId: string;
	path: string | readonly string[] | null;
	chatSessionId?: string | undefined;
	testid?: string;
}) {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const draftIds = useMemo(
		() =>
			typeof path === "string" || path === null
				? fileDraftIds(comments, path)
				: path.flatMap((each) => fileDraftIds(comments, each)),
		[comments, path],
	);
	return (
		<SendButtonBase
			testid={testid}
			label={`Send review (${draftIds.length})`}
			count={draftIds.length}
			send={() => sendReviewBatch(workspaceId, draftIds, chatSessionId)}
		/>
	);
}

export function SendAllReviewsButton({
	workspaceId,
	testid = "review-send-all",
	verb = "Send all",
}: {
	workspaceId: string;
	testid?: string;
	verb?: string;
}) {
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const count = useMemo(() => allDraftIds(comments).length, [comments]);
	return (
		<SendButtonBase
			testid={testid}
			label={`${verb} (${count})`}
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
			className="flex h-panel-header-control shrink-0 items-center gap-4 rounded-sm bg-control-primary-bg px-8 text-control-primary-text tr-text-action transition-colors hover:bg-control-primary-bg-hovered disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
		>
			<Send className="size-12" />
			{label}
		</button>
	);
}
