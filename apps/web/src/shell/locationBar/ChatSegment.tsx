import {
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiFolderOpenLine as FolderOpen,
	RiAddLine as Plus,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { RunningIcon } from "../../components/RunningIcon";
import { chatDisplayName, chatLabel, copyText } from "../../lib";
import { ChatDeleteDialog } from "../../panels/ChatDeleteDialog";
import { deleteProjectlessChat, startProjectlessChat } from "../../panels/chatActions";
import { revealWorkspace } from "../../panels/workspaceActions";
import {
	selectChatWorkspaceFirstPrompt,
	selectChatWorkspaces,
	selectChatWorkspaceTitle,
	selectWorkspaceIsRunning,
	useAppStore,
} from "../../store";
import { PillChevron, pillClass, Segment } from "./Segment";

/** The topbar's `Chats › <title>` for a chat without a project: the conversation's title, the sibling chats, and the chat's few actions. */
export function ChatSegment({ workspace }: { workspace: Workspace }) {
	const t = useT();
	const realTitle = useAppStore((s) => selectChatWorkspaceTitle(s, workspace.id));
	const firstPrompt = useAppStore((s) => selectChatWorkspaceFirstPrompt(s, workspace.id));
	const label = chatLabel(t, realTitle, firstPrompt);
	const title = label.text;
	const running = useAppStore((s) => selectWorkspaceIsRunning(s, workspace.id));
	const siblings = useAppStore(
		useShallow((s) =>
			selectChatWorkspaces(s).filter(
				(chat) => chat.id === workspace.id || chat.deletionPending !== true,
			),
		),
	);
	const titles = useAppStore(
		useShallow((s) =>
			siblings.map((chat) =>
				chatDisplayName(
					t,
					selectChatWorkspaceTitle(s, chat.id),
					selectChatWorkspaceFirstPrompt(s, chat.id),
				),
			),
		),
	);
	const [confirming, setConfirming] = useState<string | null>(null);
	const pending = workspace.deletionPending === true;
	useEffect(() => {
		if (confirming !== null && confirming !== workspace.id) setConfirming(null);
	}, [confirming, workspace.id]);
	return (
		<Segment
			caption={t("shell.location.chat.caption")}
			testid="scope-chat-segment"
			className="min-w-64 max-w-[460px] pl-0 sm:pl-8"
		>
			<DropdownMenu>
				<DropdownMenuTrigger
					data-testid="scope-workspace"
					aria-label={t("shell.location.workspace.label", { name: title })}
					className={pillClass}
				>
					{running ? <RunningIcon className="size-14 text-text-muted" /> : null}
					<span
						data-testid="scope-name"
						data-title-source={label.source}
						title={label.tooltip}
						className="truncate tr-title-section"
					>
						{title}
					</span>
					<PillChevron className="hidden sm:block" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" data-testid="scope-chat-menu">
					<DropdownMenuLabel>{t("panels.chats.title")}</DropdownMenuLabel>
					{siblings.map((chat, index) => (
						<DropdownMenuItem
							key={chat.id}
							data-testid="scope-chat-option"
							data-active={chat.id === workspace.id || undefined}
							onSelect={() => useAppStore.getState().activateWorkspace(chat)}
						>
							<span className="flex w-14 shrink-0 justify-center">
								{chat.id === workspace.id ? <Check className="text-primary" /> : null}
							</span>
							<span className="truncate">{titles[index]}</span>
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						data-testid="scope-chat-new"
						onSelect={() => void startProjectlessChat()}
					>
						<Plus />
						{t("panels.chats.newChat")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => void copyText(workspace.worktreePath)}>
						<Copy />
						{t("shell.location.workspace.copyPath")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => revealWorkspace(workspace)}>
						<FolderOpen />
						{t("shell.location.workspace.reveal")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						data-testid="scope-chat-delete"
						className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
						onSelect={() => {
							if (pending) void deleteProjectlessChat(workspace.id);
							else setConfirming(workspace.id);
						}}
					>
						<Trash2 />
						{pending ? t("panels.chats.retryDelete") : t("panels.chats.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ChatDeleteDialog
				workspaceId={confirming === workspace.id ? confirming : null}
				name={title}
				onClose={() => setConfirming(null)}
			/>
		</Segment>
	);
}
