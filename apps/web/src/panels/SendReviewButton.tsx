import { RiSendPlaneLine as Send } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
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
	const t = useT();
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
			label={t("panels.sendReview.file", { total: draftIds.length })}
			count={draftIds.length}
			send={() => sendReviewBatch(workspaceId, draftIds, chatSessionId)}
		/>
	);
}

export function SendAllReviewsButton({
	workspaceId,
	testid = "review-send-all",
	verb,
}: {
	workspaceId: string;
	testid?: string;
	verb?: string;
}) {
	const t = useT();
	const comments = useAppStore((s) => s.reviewsByWorkspace[workspaceId]?.comments);
	const count = useMemo(() => allDraftIds(comments).length, [comments]);
	return (
		<SendButtonBase
			testid={testid}
			label={t("panels.sendReview.withCount", {
				verb: verb ?? t("panels.sendReview.sendAll"),
				total: count,
			})}
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
		await send()
			.catch(() => {})
			.finally(() => setBusy(false));
	};
	return (
		<Button
			variant="primary"
			size="m"
			iconLeft={Send}
			data-testid={testid}
			loading={busy}
			onClick={() => void run()}
			className="shrink-0"
		>
			{label}
		</Button>
	);
}
