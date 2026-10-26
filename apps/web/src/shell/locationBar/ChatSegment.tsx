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
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { RunningIcon } from "../../components/RunningIcon";
import { copyText } from "../../lib";
import { ConfirmDialog } from "../../panels/ConfirmDialog";
import { deleteProjectlessChat, startProjectlessChat } from "../../panels/chatActions";
import { revealWorkspace } from "../../panels/workspaceActions";
import {
	selectChatWorkspaces,
	selectChatWorkspaceTitle,
	selectWorkspaceIsRunning,
	useAppStore,
} from "../../store";
import { PillChevron, pillClass, Segment } from "./Segment";

/** The topbar's `Chats › <title>` for a chat without a project: the conversation's title, the sibling chats, and the chat's few actions. */
export function ChatSegment({ workspace }: { workspace: Workspace }) {
	const t = useT();
	const title = useAppStore(
		(s) => selectChatWorkspaceTitle(s, workspace.id) ?? t("panels.chats.untitled"),
	);
	const running = useAppStore((s) => selectWorkspaceIsRunning(s, workspace.id));
	const siblings = useAppStore(useShallow(selectChatWorkspaces));
	const titles = useAppStore(
		useShallow((s) =>
			siblings.map((chat) => selectChatWorkspaceTitle(s, chat.id) ?? t("panels.chats.untitled")),
		),
	);
	const [confirmOpen, setConfirmOpen] = useState(false);
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
					<span data-testid="scope-name" className="truncate tr-title-section">
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
						onSelect={() => setConfirmOpen(true)}
					>
						<Trash2 />
						{t("panels.chats.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={t("panels.chats.deleteTitle", { name: title })}
				description={t("panels.chats.deleteDescription")}
				confirmLabel={t("common.delete")}
				destructive
				confirmTestId="confirm-delete-chat"
				onConfirm={() => void deleteProjectlessChat(workspace.id)}
			/>
		</Segment>
	);
}
