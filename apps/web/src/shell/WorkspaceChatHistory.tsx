import { SESSION_TITLE_MAX_LENGTH } from "@thinkrail/contracts";
import {
	RiHistoryLine as History,
	RiLoader4Line as Loader2,
	RiPencilLine as Pencil,
	RiArrowGoBackLine as RotateCcw,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { prepareChatTitle } from "../chat/chatTitle";
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
	onRenameChat,
}: {
	workspaceId: string;
	targetGroupId: string;
	onRenameChat?: (sessionId: string, title: string) => void;
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
					<ClosedChatRow
						key={chat.sessionId}
						chat={chat}
						workspaceId={workspaceId}
						targetGroupId={targetGroupId}
						{...(onRenameChat ? { onRenameChat } : {})}
					/>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ClosedChatRow({
	chat,
	workspaceId,
	targetGroupId,
	onRenameChat,
}: {
	chat: ClosedChat;
	workspaceId: string;
	targetGroupId: string;
	onRenameChat?: (sessionId: string, title: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const editStartTitleRef = useRef(chat.title);
	const cancelNextBlurRef = useRef(false);
	const [editing, setEditing] = useState(false);

	useEffect(() => {
		if (!editing) return;
		let focusFrame = 0;
		const menuFrame = requestAnimationFrame(() => {
			focusFrame = requestAnimationFrame(() => {
				inputRef.current?.focus();
				inputRef.current?.select();
			});
		});
		return () => {
			cancelAnimationFrame(menuFrame);
			cancelAnimationFrame(focusFrame);
		};
	}, [editing]);

	const commitRename = () => {
		if (cancelNextBlurRef.current) {
			cancelNextBlurRef.current = false;
			setEditing(false);
			return;
		}
		const prepared = prepareChatTitle(inputRef.current?.value ?? "");
		setEditing(false);
		if ("reason" in prepared || prepared.title === editStartTitleRef.current) return;
		onRenameChat?.(chat.sessionId, prepared.title);
	};

	const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		event.stopPropagation();
		if (event.key === "Enter") {
			event.preventDefault();
			inputRef.current?.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelNextBlurRef.current = true;
			inputRef.current?.blur();
		}
	};

	return (
		<DropdownMenuGroup
			data-testid="closed-chat-row"
			data-session-id={chat.sessionId}
			className="flex items-center"
		>
			{editing ? (
				<div className="flex min-w-0 flex-1 items-center px-8 py-4">
					<input
						ref={inputRef}
						data-testid="closed-chat-name-input"
						type="text"
						spellCheck={false}
						aria-label="Chat name"
						defaultValue={chat.title}
						maxLength={SESSION_TITLE_MAX_LENGTH}
						onKeyDown={onNameKeyDown}
						onBlur={commitRename}
						className="min-w-0 flex-1 border-0 bg-transparent p-0 tr-text-ui text-text-default outline-none"
					/>
				</div>
			) : (
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
			)}
			{onRenameChat ? (
				editing ? (
					<span aria-hidden className="w-24 shrink-0" />
				) : (
					<IconTooltip label="Rename chat">
						<DropdownMenuItem
							data-testid="closed-chat-rename"
							aria-label={`Rename ${chat.title}`}
							onSelect={(event) => {
								event.preventDefault();
								editStartTitleRef.current = chat.title;
								cancelNextBlurRef.current = false;
								setEditing(true);
							}}
							className="shrink-0 px-4 text-text-muted"
						>
							<Pencil className="size-14" />
						</DropdownMenuItem>
					</IconTooltip>
				)
			) : null}
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
	);
}

const EMPTY_CHATS: ClosedChat[] = [];
