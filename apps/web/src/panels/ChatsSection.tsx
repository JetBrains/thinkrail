import {
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiFolderOpenLine as FolderOpen,
	RiMailOpenLine as MailOpen,
	RiMailUnreadLine as MailUnread,
	RiMore2Line as MoreVertical,
	RiAddLine as Plus,
	RiChat3Fill,
	RiChat3Line,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { EditorInfo, Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { cn } from "@thinkrail/ui/utils";
import { type MouseEvent, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AttentionDot } from "@/components/AttentionDot";
import { RunningIcon } from "@/components/RunningIcon";
import { chatLabel, copyText } from "@/lib";
import {
	selectChatsContainer,
	selectChatWorkspaceFirstPrompt,
	selectChatWorkspaces,
	selectChatWorkspaceTitle,
	selectWorkspaceIsRunning,
	selectWorkspaceNeedsAttention,
	selectWorkspaceReadAction,
	supportsProjectlessChats,
	supportsWorkspaceReadState,
	useAppStore,
	type WorkspaceReadAction,
} from "../store";
import { ChatDeleteDialog } from "./ChatDeleteDialog";
import { deleteProjectlessChat, startProjectlessChat } from "./chatActions";
import {
	loadProjectWorkspaces,
	markWorkspaceRead,
	markWorkspaceUnread,
	openWorkspaceIn,
	revealWorkspace,
	useEditors,
} from "./workspaceActions";

const HOVER_CONTROL_CLASS =
	"shrink-0 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100";

export function ChatsSection() {
	const t = useT();
	const container = useAppStore(selectChatsContainer);
	const supported = useAppStore((s) => supportsProjectlessChats(s.protocolVersion));
	const chats = useAppStore(useShallow(selectChatWorkspaces));
	const loaded = useAppStore((s) => (container ? s.workspaces[container.id] !== undefined : false));
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const sessionStateByWorkspace = useAppStore((s) => s.sessionStateByWorkspace);
	const editors = useEditors();
	const [starting, setStarting] = useState(false);
	const containerId = container?.id ?? null;

	useEffect(() => {
		if (!containerId || loaded) return;
		void loadProjectWorkspaces(containerId).catch(() => {});
	}, [containerId, loaded]);

	if (!supported) return null;
	const stateProjection = { sessionStateByWorkspace };

	const newChat = () => {
		if (starting) return;
		setStarting(true);
		void startProjectlessChat().finally(() => setStarting(false));
	};

	return (
		<section data-testid="chats-section" className="flex flex-col gap-4">
			<header className="flex h-panel-row items-center justify-between pr-4 pl-8">
				<span className="tr-text-eyebrow text-text-muted">{t("panels.chats.title")}</span>
				<IconButton
					icon={Plus}
					label={t("panels.chats.newChat")}
					variant="ghost"
					size="s"
					data-testid="add-chat"
					disabled={starting}
					onClick={newChat}
				/>
			</header>
			{chats.length === 0 ? (
				<p data-testid="chats-empty" className="px-8 pb-4 tr-text-metadata text-text-subtle">
					{t("panels.chats.empty")}
				</p>
			) : (
				<ul className="flex flex-col">
					{chats.map((chat) => (
						<ChatRow
							key={chat.id}
							workspace={chat}
							title={selectChatWorkspaceTitle(stateProjection, chat.id)}
							isActive={activeWorkspaceId === chat.id}
							needsAttention={selectWorkspaceNeedsAttention(stateProjection, chat.id)}
							isRunning={selectWorkspaceIsRunning(stateProjection, chat.id)}
							readAction={
								supportsWorkspaceReadState(protocolVersion)
									? selectWorkspaceReadAction(stateProjection, chat.id)
									: null
							}
							editors={editors}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

function ChatRow({
	workspace,
	title,
	isActive,
	needsAttention,
	isRunning,
	readAction,
	editors,
}: {
	workspace: Workspace;
	title: string | null;
	isActive: boolean;
	needsAttention: boolean;
	isRunning: boolean;
	readAction: WorkspaceReadAction | null;
	editors: EditorInfo[];
}) {
	const t = useT();
	const firstPrompt = useAppStore((s) => selectChatWorkspaceFirstPrompt(s, workspace.id));
	const label = chatLabel(t, title, firstPrompt);
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const pending = workspace.deletionPending === true;
	const Icon = isActive ? RiChat3Fill : RiChat3Line;
	const openMenuFromContext = (event: MouseEvent) => {
		event.preventDefault();
		setMenuOpen(true);
	};
	return (
		<li>
			<fieldset
				aria-label={label.text}
				data-testid="chat-item"
				data-row
				data-active={isActive}
				data-attention={needsAttention || undefined}
				data-running={isRunning || undefined}
				data-deletion-pending={pending || undefined}
				onContextMenu={openMenuFromContext}
				className={cn(
					"group relative flex min-h-panel-row min-w-0 items-center gap-8 rounded-sm border-0 py-2 pr-4 pl-8 transition-colors",
					isActive || menuOpen ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
				)}
			>
				<button
					type="button"
					disabled={pending}
					onClick={() => useAppStore.getState().activateWorkspace(workspace)}
					className="flex min-w-0 flex-1 items-center gap-4 text-left"
				>
					{isRunning ? (
						<RunningIcon className={cn("size-14", isActive ? "text-primary" : "text-text-muted")} />
					) : (
						<Icon
							className={cn("size-14 shrink-0", isActive ? "text-primary" : "text-text-muted")}
						/>
					)}
					<span className="flex min-w-0 flex-1 flex-col">
						<span
							data-testid="chat-title"
							data-title-source={label.source}
							title={label.tooltip}
							className={cn(
								"truncate tr-text-ui leading-tight",
								isActive ? "text-primary" : "text-text-muted",
							)}
						>
							{label.text}
						</span>
						{pending ? (
							<span className="truncate text-feedback-warning tr-text-metadata leading-tight">
								{t("panels.chats.deletionPending")}
							</span>
						) : null}
					</span>
				</button>
				{needsAttention ? <AttentionDot /> : null}
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger asChild>
						<IconButton
							icon={MoreVertical}
							label={t("panels.chats.chatActions", { name: label.text })}
							variant="ghost"
							size="s"
							data-testid="chat-menu"
							className={HOVER_CONTROL_CLASS}
						/>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" data-testid="chat-actions">
						{pending ? null : (
							<>
								{editors.length > 0 && (
									<DropdownMenuSub>
										<DropdownMenuSubTrigger>
											<ExternalLink />
											{t("panels.projectTree.openIn")}
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent>
											{editors.map((editor) => (
												<DropdownMenuItem
													key={editor.id}
													onSelect={() => openWorkspaceIn(workspace, editor)}
												>
													{editor.label}
												</DropdownMenuItem>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								)}
								<DropdownMenuItem onSelect={() => void copyText(workspace.worktreePath)}>
									<Copy />
									{t("panels.projectTree.copyPath")}
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => revealWorkspace(workspace)}>
									<FolderOpen />
									{t("panels.projectTree.reveal")}
								</DropdownMenuItem>
								{readAction === "markRead" ? (
									<DropdownMenuItem onSelect={() => markWorkspaceRead(workspace.id)}>
										<MailOpen />
										{t("panels.projectTree.markRead")}
									</DropdownMenuItem>
								) : readAction === "markUnread" ? (
									<DropdownMenuItem onSelect={() => markWorkspaceUnread(workspace.id)}>
										<MailUnread />
										{t("panels.projectTree.markUnread")}
									</DropdownMenuItem>
								) : null}
								<DropdownMenuSeparator />
							</>
						)}
						<DropdownMenuItem
							data-testid="chat-delete"
							className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
							onSelect={(event) => {
								event.preventDefault();
								if (pending) void deleteProjectlessChat(workspace.id);
								else setConfirming(true);
							}}
						>
							<Trash2 />
							{pending ? t("panels.chats.retryDelete") : t("panels.chats.delete")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</fieldset>
			<ChatDeleteDialog
				workspaceId={confirming ? workspace.id : null}
				name={label.text}
				onClose={() => setConfirming(false)}
			/>
		</li>
	);
}
