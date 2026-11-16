import {
	RiFileCopyLine as Copy,
	RiFileCopy2Line as CopyEntry,
	type RemixiconComponentType,
	RiArrowGoBackLine,
	RiAtLine,
	RiChat3Line,
	RiClipboardLine,
	RiDeleteBinLine,
	RiEditLine,
	RiFileLine,
	RiFolderOpenLine,
	RiImageLine,
	RiListCheck3,
	RiPagesLine,
	RiScissorsCutLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	openContextMenuFromKeyboard,
} from "@thinkrail/ui/context-menu";
import { type KeyboardEvent, type ReactElement, useRef, useState } from "react";
import { copyText, joinWorkspacePath } from "../lib";
import { selectChatTitle, selectWorkspaceById, supportsArtifacts, useAppStore } from "../store";
import { mentionArtifact, revealArtifact, selectArtifactMentionTarget } from "./artifactActions";
import type { ArtifactRow } from "./artifactsModel";
import { pasteInto } from "./fileTreeActions";
import { OpenInBrowserMenuItem } from "./OpenInBrowserButton";
import { openChatInTab } from "./openChat";
import { treeRowControlProps, treeRowKey } from "./treeNavigation";

export type RequestRemoval = (path: string, kept: boolean) => void;
export type RowKeyDown = (event: KeyboardEvent<HTMLElement>) => void;

export function NewDot() {
	return (
		<span
			aria-hidden="true"
			data-testid="artifact-new"
			className="size-6 shrink-0 rounded-full bg-primary"
		/>
	);
}

export function artifactIcon(row: ArtifactRow): RemixiconComponentType {
	if (row.taskSpecStatus !== null) return RiListCheck3;
	const name = row.name.toLowerCase();
	if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/.test(name)) return RiImageLine;
	if (/\.html?$/.test(name)) return RiPagesLine;
	return RiFileLine;
}

export function ChatChip({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
	const t = useT();
	const title = useAppStore((s) => selectChatTitle(t, s, workspaceId, sessionId));
	return (
		<button
			type="button"
			data-testid="artifact-chat"
			{...treeRowControlProps}
			title={t("panels.artifacts.openChat", { chat: title })}
			onClick={() => void openChatInTab(workspaceId, sessionId)}
			className="min-w-0 max-w-full shrink truncate rounded-sm bg-control-bg px-4 text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default"
		>
			{title}
		</button>
	);
}

export function ArtifactEntryMenu({
	workspaceId,
	path,
	folder = false,
	deleted = false,
	onRestore,
	sessionId,
	onRename,
	onRemove,
	onCloseAutoFocus,
	children,
}: {
	workspaceId: string;
	path: string;
	folder?: boolean;
	deleted?: boolean;
	onRestore?: (() => void) | undefined;
	sessionId?: string | undefined;
	onRename?: () => void;
	onRemove?: ((path: string) => void) | undefined;
	onCloseAutoFocus?: (event: Event) => void;
	children: (menuOpen: boolean, onRowKeyDown: RowKeyDown) => ReactElement;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const mentionOnCloseRef = useRef(false);
	const canMention = useAppStore((s) => selectArtifactMentionTarget(s, workspaceId) !== null);
	const mutations = useAppStore((s) => supportsArtifacts(s.protocolVersion));
	const canPasteHere = useAppStore((s) => folder && s.fileClipboard !== null);
	const copyPath = (absolute: boolean) => {
		const worktreePath = selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath;
		void copyText(absolute ? joinWorkspacePath(worktreePath ?? "", path) : path);
	};
	const clip = (cut: boolean) =>
		useAppStore
			.getState()
			.setFileClipboard(cut ? { workspaceId, path, cut } : { workspaceId, path });
	const rename = mutations && !deleted ? onRename : undefined;
	const remove = mutations ? onRemove : undefined;
	const onRowKeyDown: RowKeyDown = (event) => {
		const key = treeRowKey(event);
		if (key === "delete" && remove) remove(path);
		else if (key === "rename" && rename) rename();
		else return;
		event.preventDefault();
	};
	return (
		<ContextMenu open={open} onOpenChange={setOpen}>
			<ContextMenuTrigger asChild onKeyDown={openContextMenuFromKeyboard}>
				{children(open, onRowKeyDown)}
			</ContextMenuTrigger>
			<ContextMenuContent
				data-testid="artifact-actions"
				onCloseAutoFocus={(event) => {
					if (!mentionOnCloseRef.current) return onCloseAutoFocus?.(event);
					mentionOnCloseRef.current = false;
					event.preventDefault();
					mentionArtifact(workspaceId, folder ? `${path}/` : path);
				}}
			>
				{deleted ? (
					onRestore ? (
						<ContextMenuItem data-testid="artifact-menu-restore" onSelect={onRestore}>
							<RiArrowGoBackLine />
							{t("panels.artifacts.restore")}
						</ContextMenuItem>
					) : null
				) : (
					<>
						<ContextMenuItem
							data-testid="artifact-mention"
							disabled={!canMention}
							title={canMention ? undefined : t("panels.artifacts.mentionNoChat")}
							onSelect={() => {
								mentionOnCloseRef.current = true;
							}}
						>
							<RiAtLine />
							{t("panels.artifacts.mention")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="artifact-reveal"
							onSelect={() => revealArtifact(workspaceId, path)}
						>
							<RiFolderOpenLine />
							{t("panels.artifacts.reveal")}
						</ContextMenuItem>
						{folder ? null : (
							<OpenInBrowserMenuItem
								workspaceId={workspaceId}
								path={path}
								testId="artifact-open-in-browser"
							/>
						)}
					</>
				)}
				{sessionId ? <OpenChatItem workspaceId={workspaceId} sessionId={sessionId} /> : null}
				{!deleted || onRestore || sessionId ? <ContextMenuSeparator /> : null}
				<ContextMenuItem data-testid="artifact-copy-path" onSelect={() => copyPath(true)}>
					<Copy />
					{t("panels.fileTree.copyPath")}
				</ContextMenuItem>
				<ContextMenuItem data-testid="artifact-copy-relative-path" onSelect={() => copyPath(false)}>
					<Copy />
					{t("panels.fileTree.copyRelativePath")}
				</ContextMenuItem>
				{mutations && !deleted ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem data-testid="artifact-copy" onSelect={() => clip(false)}>
							<CopyEntry />
							{t("common.copy")}
						</ContextMenuItem>
						<ContextMenuItem data-testid="artifact-cut" onSelect={() => clip(true)}>
							<RiScissorsCutLine />
							{t("panels.fileTree.cut")}
						</ContextMenuItem>
						{canPasteHere ? (
							<ContextMenuItem
								data-testid="artifact-paste-here"
								onSelect={() => void pasteInto(workspaceId, path)}
							>
								<RiClipboardLine />
								{t("panels.artifacts.pasteHere")}
							</ContextMenuItem>
						) : null}
						{rename ? (
							<ContextMenuItem data-testid="artifact-rename" onSelect={rename}>
								<RiEditLine />
								{t("panels.artifacts.rename")}
							</ContextMenuItem>
						) : null}
					</>
				) : null}
				{remove ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem
							data-testid="artifact-delete"
							className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
							onSelect={(event) => {
								event.preventDefault();
								setOpen(false);
								requestAnimationFrame(() => remove(path));
							}}
						>
							<RiDeleteBinLine />
							{t("common.delete")}
						</ContextMenuItem>
					</>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}

function OpenChatItem({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
	const t = useT();
	const title = useAppStore((s) => selectChatTitle(t, s, workspaceId, sessionId));
	return (
		<ContextMenuItem
			data-testid="artifact-open-chat"
			onSelect={() => void openChatInTab(workspaceId, sessionId)}
		>
			<RiChat3Line />
			{t("panels.artifacts.openChat", { chat: title })}
		</ContextMenuItem>
	);
}
