import {
	RiHistoryLine as History,
	RiLoader4Line as Loader2,
	RiPencilLine as Pencil,
	RiArrowGoBackLine as RotateCcw,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { menuItemClass } from "../components/ui/menu-styles";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { IconTooltip } from "../components/ui/tooltip";
import { cn, relativeTime } from "../lib";
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
	onRenameChat?: (sessionId: string, titleInput: string, currentTitle: string) => void;
}) {
	const closed = useAppStore((state) => state.closedChatsByWorkspace[workspaceId] ?? EMPTY_CHATS);
	const chatStarting = useAppStore((state) => (state.chatStartsByWorkspace[workspaceId] ?? 0) > 0);
	const [open, setOpen] = useState(false);
	const headingId = useId();
	if (closed.length === 0) return null;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<IconTooltip label="View chat history" wrapTrigger>
				<PopoverTrigger
					data-testid="chat-history"
					aria-label="Reopen a closed chat"
					className="flex w-32 shrink-0 items-center justify-center border-border-default border-l text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					{chatStarting ? (
						<Loader2 className="size-14 animate-spin motion-reduce:animate-none" />
					) : (
						<History className="size-14" />
					)}
				</PopoverTrigger>
			</IconTooltip>
			<PopoverContent
				align="end"
				data-testid="chat-history-popover"
				aria-labelledby={headingId}
				onEscapeKeyDown={(event) => {
					if (
						globalThis.document.activeElement?.getAttribute("data-testid") ===
						"closed-chat-name-input"
					) {
						event.preventDefault();
					}
				}}
				className="max-h-[min(60vh,var(--radix-popover-content-available-height))] min-w-[16rem] overflow-y-auto p-4"
			>
				<div id={headingId} className="px-8 py-4 tr-text-eyebrow text-text-muted">
					Recently closed
				</div>
				{closed.map((chat) => (
					<ClosedChatRow
						key={chat.sessionId}
						chat={chat}
						workspaceId={workspaceId}
						targetGroupId={targetGroupId}
						onDismiss={() => setOpen(false)}
						{...(onRenameChat ? { onRenameChat } : {})}
					/>
				))}
			</PopoverContent>
		</Popover>
	);
}

function ClosedChatRow({
	chat,
	workspaceId,
	targetGroupId,
	onDismiss,
	onRenameChat,
}: {
	chat: ClosedChat;
	workspaceId: string;
	targetGroupId: string;
	onDismiss: () => void;
	onRenameChat?: (sessionId: string, titleInput: string, currentTitle: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const reopenButtonRef = useRef<HTMLButtonElement>(null);
	const editStartTitleRef = useRef(chat.title);
	const cancelNextBlurRef = useRef(false);
	const restoreRowFocusRef = useRef(false);
	const [editing, setEditing] = useState(false);

	useEffect(() => {
		if (!editing) return;
		const frame = requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
		return () => cancelAnimationFrame(frame);
	}, [editing]);

	const closeNameEditor = () => {
		setEditing(false);
		if (!restoreRowFocusRef.current) return;
		restoreRowFocusRef.current = false;
		requestAnimationFrame(() => reopenButtonRef.current?.focus());
	};

	const commitRename = () => {
		if (cancelNextBlurRef.current) {
			cancelNextBlurRef.current = false;
			closeNameEditor();
			return;
		}
		const titleInput = inputRef.current?.value ?? "";
		closeNameEditor();
		onRenameChat?.(chat.sessionId, titleInput, editStartTitleRef.current);
	};

	const onNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		event.stopPropagation();
		if (event.key === "Enter") {
			event.preventDefault();
			restoreRowFocusRef.current = true;
			inputRef.current?.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			restoreRowFocusRef.current = true;
			cancelNextBlurRef.current = true;
			inputRef.current?.blur();
		}
	};

	return (
		<div
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
						onKeyDown={onNameKeyDown}
						onBlur={commitRename}
						className="min-w-0 flex-1 border-0 bg-transparent p-0 tr-text-ui text-text-default outline-none"
					/>
				</div>
			) : (
				<button
					ref={reopenButtonRef}
					type="button"
					data-testid="closed-chat-item"
					data-session-id={chat.sessionId}
					onClick={() => {
						onDismiss();
						const navigation = useAppStore
							.getState()
							.beginCenterNavigation(workspaceId, targetGroupId);
						void openChatInTab(workspaceId, chat.sessionId, navigation);
					}}
					className={cn(menuItemClass, "min-w-0 flex-1")}
				>
					<span className="flex-1 truncate">{chat.title}</span>
					<span className="shrink-0 tr-text-metadata text-text-muted">
						{relativeTime(chat.closedAt)}
					</span>
					<RotateCcw className="size-14 shrink-0 text-text-muted" />
				</button>
			)}
			{onRenameChat ? (
				editing ? (
					<span aria-hidden className="w-24 shrink-0" />
				) : (
					<IconTooltip label="Rename chat">
						<button
							type="button"
							data-testid="closed-chat-rename"
							aria-label={`Rename ${chat.title}`}
							onClick={() => {
								editStartTitleRef.current = chat.title;
								cancelNextBlurRef.current = false;
								restoreRowFocusRef.current = false;
								setEditing(true);
							}}
							className={cn(menuItemClass, "shrink-0 px-4 text-text-muted")}
						>
							<Pencil className="size-14" />
						</button>
					</IconTooltip>
				)
			) : null}
			<IconTooltip label="Move chat to trash">
				<button
					type="button"
					data-testid="closed-chat-delete"
					aria-label={`Move ${chat.title} to trash`}
					onClick={() => {
						onDismiss();
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
					className={cn(menuItemClass, "shrink-0 px-4 text-text-muted focus:text-feedback-error")}
				>
					<Trash2 className="size-14" />
				</button>
			</IconTooltip>
		</div>
	);
}

const EMPTY_CHATS: ClosedChat[] = [];
