import { RiArrowDownSLine as ChevronDown, RiSendPlaneLine as Send } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectOpenChatTitles, useAppStore } from "../store";
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
			pickerWorkspaceId={chatSessionId ? undefined : workspaceId}
			send={(target) => sendReviewBatch(workspaceId, draftIds, target ?? chatSessionId)}
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
			pickerWorkspaceId={workspaceId}
			send={(target) => sendReviewBatch(workspaceId, undefined, target)}
		/>
	);
}

function SendButtonBase({
	testid,
	label,
	count,
	pickerWorkspaceId,
	send,
}: {
	testid: string;
	label: string;
	count: number;
	pickerWorkspaceId: string | undefined;
	send: (target?: string) => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);
	if (count === 0) return null;
	const run = async (target?: string) => {
		setBusy(true);
		await send(target)
			.catch(() => {})
			.finally(() => setBusy(false));
	};
	return (
		<div className="inline-flex shrink-0 items-center gap-2">
			<Button
				variant="primary"
				size="m"
				iconLeft={Send}
				data-testid={testid}
				loading={busy}
				onClick={() => void run()}
			>
				{label}
			</Button>
			{pickerWorkspaceId && (
				<ReviewChatMenu workspaceId={pickerWorkspaceId} busy={busy} onSend={run} />
			)}
		</div>
	);
}

function ReviewChatMenu({
	workspaceId,
	busy,
	onSend,
}: {
	workspaceId: string;
	busy: boolean;
	onSend: (target: string) => Promise<void>;
}) {
	const t = useT();
	const titles = useAppStore(useShallow((s) => selectOpenChatTitles(t, s, workspaceId)));
	const chats = Object.entries(titles);
	if (chats.length === 0) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton
					icon={ChevronDown}
					label={t("panels.sendReview.chooseChat")}
					disabled={busy}
					wrapTrigger
				/>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" aria-label={t("panels.sendReview.chooseChat")}>
				{chats.map(([sessionId, title]) => (
					<DropdownMenuItem key={sessionId} onSelect={() => void onSend(sessionId)}>
						{title}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
