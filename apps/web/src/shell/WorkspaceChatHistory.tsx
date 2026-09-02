import {
	RiHistoryLine as History,
	RiLoader4Line as Loader2,
	RiArrowGoBackLine as RotateCcw,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { IconTooltip } from "../components/ui/tooltip";
import { relativeTime } from "../lib";
import { openChatInTab } from "../panels/openChat";
import { type ClosedChat, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";

export function WorkspaceChatHistory({
	workspaceId,
	targetGroupId,
}: {
	workspaceId: string;
	targetGroupId: string;
}) {
	const closed = useAppStore((state) => state.closedChatsByWorkspace[workspaceId] ?? EMPTY_CHATS);
	const chatStarting = useAppStore((state) => (state.chatStartsByWorkspace[workspaceId] ?? 0) > 0);
	if (closed.length === 0) return null;
	return (
		<DropdownMenu>
			<IconTooltip label="View chat history" wrapTrigger>
				<DropdownMenuTrigger
					data-testid="chat-history"
					aria-label="Reopen a closed chat"
					className="flex w-32 shrink-0 items-center justify-center border-border-default border-l text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					{chatStarting ? (
						<Loader2 className="size-14 animate-spin motion-reduce:animate-none" />
					) : (
						<History className="size-14" />
					)}
				</DropdownMenuTrigger>
			</IconTooltip>
			<DropdownMenuContent align="end" className="min-w-[16rem]">
				<DropdownMenuLabel>Recently closed</DropdownMenuLabel>
				{closed.map((chat) => (
					<DropdownMenuGroup
						key={chat.sessionId}
						data-testid="closed-chat-row"
						className="flex items-center"
					>
						<DropdownMenuItem
							data-testid="closed-chat-item"
							data-session-id={chat.sessionId}
							onSelect={() => {
								const navigation = useAppStore
									.getState()
									.beginCenterNavigation(workspaceId, targetGroupId);
								void openChatInTab(workspaceId, chat.sessionId, navigation);
							}}
							className="min-w-0 flex-1"
						>
							<span className="flex-1 truncate">{chat.title}</span>
							<span className="shrink-0 tr-text-metadata text-text-muted">
								{relativeTime(chat.closedAt)}
							</span>
							<RotateCcw className="size-14 shrink-0 text-text-muted" />
						</DropdownMenuItem>
						<IconTooltip label="Move chat to trash">
							<DropdownMenuItem
								data-testid="closed-chat-delete"
								aria-label={`Move ${chat.title} to trash`}
								onSelect={() => {
									void getTransport()
										.request("session.delete", { workspaceId, sessionId: chat.sessionId })
										.then(() => useAppStore.getState().deleteChat(workspaceId, chat.sessionId))
										.catch((error) => {
											const state = useAppStore.getState();
											if (
												!state.removedWorkspaceIds[workspaceId] &&
												!state.deletedSessionsByWorkspace[workspaceId]?.[chat.sessionId]
											) {
												toast.error(errorText(error), "Couldn't delete the chat");
											}
										});
								}}
								className="shrink-0 px-4 text-text-muted focus:text-feedback-error"
							>
								<Trash2 className="size-14" />
							</DropdownMenuItem>
						</IconTooltip>
					</DropdownMenuGroup>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const EMPTY_CHATS: ClosedChat[] = [];
