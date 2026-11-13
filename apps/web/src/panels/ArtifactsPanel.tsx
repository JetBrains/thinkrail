import {
	RiFileCopyLine as Copy,
	RiFileCopy2Line as CopyEntry,
	RiArrowGoBackLine,
	RiAtLine,
	RiClipboardLine,
	RiDeleteBinLine,
	RiEditLine,
	RiEyeLine,
	RiEyeOffLine,
	RiFileLine,
	RiFolderOpenLine,
	RiImageLine,
	RiListCheck3,
	RiPagesLine,
	RiRefreshLine,
	RiScissorsCutLine,
	RiShapesLine,
} from "@remixicon/react";
import type { FileNode } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
	openContextMenuFromKeyboard,
} from "@thinkrail/ui/context-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { useNow } from "@/components/useNow";
import { copyText, fileName, firstClickOnly, joinWorkspacePath, relativeTime } from "../lib";
import {
	artifactsWatermark,
	selectChatTitle,
	selectWorkspaceById,
	supportsArtifacts,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import {
	discardArtifact,
	mentionArtifact,
	restoreArtifact,
	revealArtifact,
	selectArtifactMentionTarget,
} from "./artifactActions";
import { type ArtifactRow, artifactRows, type OutputRow } from "./artifactsModel";
import { ConfirmDialog } from "./ConfirmDialog";
import { deleteEntry, pasteInto, renameEntry, supportsMoves } from "./fileTreeActions";
import { HeaderIconButton } from "./HeaderIconButton";
import { openChatInTab } from "./openChat";
import { openFileInTab } from "./openTabs";
import { TreeRow } from "./TreeRow";
import { useWorkspaceRead } from "./useWorkspaceRead";
import { useInlineRename } from "./workspaceActions";

interface RemovalRequest {
	path: string;
	kept: boolean;
	open: boolean;
}

type RequestRemoval = (path: string, kept: boolean) => void;

export function ArtifactsPanel({
	workspaceId,
	failed,
	onRetry,
}: {
	workspaceId: string;
	failed: boolean;
	onRetry: () => void;
}) {
	const t = useT();
	const supported = useAppStore((s) => supportsArtifacts(s.protocolVersion));
	const snapshot = useAppStore((s) => s.artifactsByWorkspace[workspaceId]);
	const specs = useAppStore((s) => s.specsByWorkspace[workspaceId]);
	const showIgnored = useAppStore((s) => s.artifactsShowIgnored);
	const mentionTarget = useAppStore((s) => selectArtifactMentionTarget(s, workspaceId));
	const canPaste = useAppStore((s) => supportsMoves(s.protocolVersion) && s.fileClipboard !== null);
	const [onlyThisChat, setOnlyThisChat] = useState(false);
	const [highlightSince, setHighlightSince] = useState<number | null>(null);
	const [removal, setRemoval] = useState<RemovalRequest | null>(null);

	useEffect(() => {
		if (!snapshot) return;
		const store = useAppStore.getState();
		if (highlightSince === null)
			setHighlightSince(store.artifactsSeenByWorkspace[workspaceId] ?? 0);
		store.markArtifactsSeen(workspaceId, artifactsWatermark(snapshot));
	}, [snapshot, workspaceId, highlightSince]);

	const sessionId = onlyThisChat ? mentionTarget : null;
	const rows = useMemo(
		() =>
			snapshot && highlightSince !== null
				? artifactRows(snapshot, { sessionId, highlightSince, showIgnored, specs })
				: null,
		[snapshot, sessionId, highlightSince, showIgnored, specs],
	);
	const requestRemoval: RequestRemoval = (path, kept) => setRemoval({ path, kept, open: true });

	if (!supported) {
		return (
			<p data-testid="artifacts-unsupported" className="p-16 text-text-subtle tr-text-ui">
				{t("panels.artifacts.unsupported")}
			</p>
		);
	}

	return (
		<div data-testid="artifacts-panel" className="flex h-full min-h-0 flex-col">
			<div
				role="toolbar"
				aria-label={t("panels.artifacts.toolbar")}
				className="flex h-panel-header-row shrink-0 items-center gap-4 overflow-clip border-border-default border-b px-12"
			>
				<ToggleSegment
					testid="artifacts-filter-all"
					label={t("panels.artifacts.allChats")}
					active={!onlyThisChat || mentionTarget === null}
					onClick={() => setOnlyThisChat(false)}
				/>
				<ToggleSegment
					testid="artifacts-filter-chat"
					label={t("panels.artifacts.thisChat")}
					active={onlyThisChat && mentionTarget !== null}
					disabled={mentionTarget === null}
					onClick={() => setOnlyThisChat(true)}
				/>
				<div className="ml-auto flex shrink-0">
					{snapshot?.outputs ? (
						<HeaderIconButton
							testid="artifacts-toggle-ignored"
							label={
								showIgnored ? t("panels.artifacts.hideIgnored") : t("panels.artifacts.showIgnored")
							}
							active={showIgnored}
							icon={showIgnored ? RiEyeLine : RiEyeOffLine}
							onClick={() => useAppStore.getState().setArtifactsShowIgnored(!showIgnored)}
						/>
					) : null}
					{canPaste && snapshot ? (
						<HeaderIconButton
							testid="artifacts-paste"
							label={t("panels.artifacts.paste")}
							icon={RiClipboardLine}
							onClick={() => void pasteInto(workspaceId, snapshot.dir)}
						/>
					) : null}
				</div>
			</div>
			<QuietScrollArea className="min-h-0 flex-1" viewportClassName="p-panel-inset">
				{failed ? (
					<div
						role="alert"
						data-testid="artifacts-error"
						className="flex items-center gap-8 rounded-sm border border-feedback-error-muted bg-feedback-error-subtle px-8 py-4 tr-text-metadata text-text-default"
					>
						<span className="min-w-0 flex-1">
							{snapshot ? t("panels.artifacts.updateFailed") : t("panels.artifacts.loadFailed")}
						</span>
						<Button
							variant="ghost"
							size="m"
							iconLeft={RiRefreshLine}
							data-testid="artifacts-retry"
							onClick={onRetry}
						>
							{t("common.retry")}
						</Button>
					</div>
				) : null}
				{rows === null ? (
					failed ? null : (
						<LoadingRegion rows={6} className="px-4 py-4" />
					)
				) : rows.artifacts.length === 0 && !rows.outputs?.length ? (
					<EmptyArtifacts onlyThisChat={sessionId !== null} />
				) : (
					<div className="flex flex-col gap-8 motion-safe:animate-reveal">
						{rows.artifacts.length > 0 ? (
							<Section
								testid="artifacts-section"
								title={t("panels.artifacts.sectionArtifacts")}
								count={rows.artifacts.length}
							>
								{rows.artifacts.map((row) => (
									<ArtifactRowView
										key={row.artifact.path}
										row={row}
										workspaceId={workspaceId}
										onRemove={requestRemoval}
									/>
								))}
							</Section>
						) : null}
						{rows.outputs?.length ? (
							<Section
								testid="artifacts-outputs-section"
								title={t("panels.artifacts.sectionOutputs")}
								count={rows.outputs.length}
							>
								{rows.outputs.map((row) => (
									<OutputRowView
										key={row.output.path}
										row={row}
										workspaceId={workspaceId}
										onRemove={requestRemoval}
									/>
								))}
							</Section>
						) : null}
					</div>
				)}
			</QuietScrollArea>
			{removal ? (
				<RemovalDialog
					workspaceId={workspaceId}
					request={removal}
					onClose={() => setRemoval({ ...removal, open: false })}
				/>
			) : null}
		</div>
	);
}

function EmptyArtifacts({ onlyThisChat }: { onlyThisChat: boolean }) {
	const t = useT();
	return (
		<div
			data-testid="artifacts-empty"
			className="flex flex-col items-center gap-8 px-16 py-24 text-center"
		>
			<RiShapesLine className="size-20 text-text-subtle" />
			<p className="text-text-default tr-text-ui">
				{onlyThisChat ? t("panels.artifacts.emptyForChat") : t("panels.artifacts.empty")}
			</p>
			<p className="text-text-muted tr-text-metadata">{t("panels.artifacts.emptyHint")}</p>
		</div>
	);
}

function Section({
	testid,
	title,
	count,
	children,
}: {
	testid: string;
	title: string;
	count: number;
	children: ReactNode;
}) {
	return (
		<section data-testid={testid} className="flex flex-col">
			<h3 className="flex items-center justify-between px-4 pb-4 text-text-subtle tr-text-metadata">
				<span>{title}</span>
				<span>{count}</span>
			</h3>
			<ul className="flex flex-col">{children}</ul>
		</section>
	);
}

function NewDot() {
	return (
		<span
			aria-hidden="true"
			data-testid="artifact-new"
			className="size-6 shrink-0 rounded-full bg-primary"
		/>
	);
}

function artifactIcon(row: ArtifactRow) {
	if (row.taskSpecStatus !== null) return RiListCheck3;
	const name = row.name.toLowerCase();
	if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/.test(name)) return RiImageLine;
	if (/\.html?$/.test(name)) return RiPagesLine;
	return RiFileLine;
}

function ChatChip({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) {
	const t = useT();
	const title = useAppStore((s) => selectChatTitle(t, s, workspaceId, sessionId));
	return (
		<button
			type="button"
			data-testid="artifact-chat"
			title={t("panels.artifacts.openChat", { chat: title })}
			onClick={() => void openChatInTab(workspaceId, sessionId)}
			className="min-w-0 max-w-full shrink truncate rounded-sm bg-control-bg px-4 text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default"
		>
			{title}
		</button>
	);
}

function ArtifactRowView({
	row,
	workspaceId,
	onRemove,
}: {
	row: ArtifactRow;
	workspaceId: string;
	onRemove: RequestRemoval;
}) {
	const t = useT();
	const now = useNow();
	const { artifact, name, folder, taskSpecStatus, fresh } = row;
	const deleted = artifact.state === "deleted";
	const { editing, nameRef, start, inputProps, onMenuCloseAutoFocus } = useInlineRename({
		target: { id: artifact.path, name },
		canRename: !deleted,
		onRename: (_target, next) => void renameEntry(workspaceId, artifact.path, next),
	});
	const Icon = artifactIcon(row);
	const open = (intent: "preview" | "keep") =>
		void openFileInTab(workspaceId, artifact.path, intent);
	const detail =
		taskSpecStatus !== null
			? t("panels.artifacts.taskSpec", { status: taskSpecStatus || "—" })
			: folder;
	return (
		<li
			data-testid="artifact-row"
			data-path={artifact.path}
			data-state={artifact.state}
			data-fresh={fresh || undefined}
		>
			<EntryMenu
				workspaceId={workspaceId}
				path={artifact.path}
				deleted={deleted}
				onRename={start}
				onRemove={(path) => onRemove(path, deleted)}
				onCloseAutoFocus={onMenuCloseAutoFocus}
			>
				{(menuOpen) => (
					<div
						className={cn(
							"flex w-full min-w-0 items-start gap-8 rounded-sm px-4 py-4",
							menuOpen ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
						)}
					>
						<Icon className="mt-2 size-14 shrink-0 text-text-muted" />
						<div className="flex min-w-0 flex-1 flex-col">
							<div className="flex min-w-0 items-center gap-8">
								{editing ? (
									<input
										ref={nameRef}
										data-testid="artifact-name-input"
										type="text"
										spellCheck={false}
										aria-label={t("panels.artifacts.name")}
										defaultValue={name}
										{...inputProps}
										className="w-full min-w-0 border-0 bg-transparent p-0 text-text-default tr-text-ui focus-visible:focus-ring"
									/>
								) : (
									<button
										type="button"
										data-testid="artifact-open"
										disabled={deleted}
										onClick={firstClickOnly(() => open("preview"))}
										onDoubleClick={() => open("keep")}
										className={cn(
											"min-w-0 flex-1 truncate text-left tr-text-ui focus-visible:focus-ring-inset",
											deleted ? "text-text-subtle line-through" : "text-text-default",
										)}
									>
										{name}
									</button>
								)}
								{fresh ? <NewDot /> : null}
								<span className="shrink-0 text-text-subtle tr-text-metadata">
									{relativeTime(t, artifact.changedAt, now)}
								</span>
							</div>
							<div className="flex min-w-0 items-center gap-8 text-text-subtle tr-text-metadata">
								{deleted ? (
									<>
										<span data-testid="artifact-deleted" className="shrink-0 text-feedback-warning">
											{t("panels.artifacts.deleted")}
										</span>
										<button
											type="button"
											data-testid="artifact-restore"
											onClick={() => void restoreArtifact(workspaceId, artifact.path)}
											className="shrink-0 text-primary hover:underline"
										>
											{t("panels.artifacts.restore")}
										</button>
									</>
								) : detail ? (
									<span className="min-w-0 truncate">{detail}</span>
								) : null}
								{artifact.sessionId ? (
									<span className="ml-auto flex min-w-0">
										<ChatChip workspaceId={workspaceId} sessionId={artifact.sessionId} />
									</span>
								) : null}
							</div>
						</div>
					</div>
				)}
			</EntryMenu>
		</li>
	);
}

function OutputRowView({
	row,
	workspaceId,
	onRemove,
}: {
	row: OutputRow;
	workspaceId: string;
	onRemove: RequestRemoval;
}) {
	const t = useT();
	const { output, fresh } = row;
	const node: FileNode = { path: output.path, name: output.path, kind: output.kind };
	return (
		<li data-testid="artifact-output" data-path={output.path} data-fresh={fresh || undefined}>
			<OutputNode
				node={node}
				workspaceId={workspaceId}
				onRemove={onRemove}
				trailing={
					<>
						{fresh ? <NewDot /> : null}
						{output.kind === "dir" ? (
							<span className="shrink-0 pr-4 text-text-subtle tr-text-metadata">
								{output.filesTruncated
									? t("panels.artifacts.filesTruncated", { count: output.files })
									: t("panels.artifacts.files", { count: output.files })}
							</span>
						) : null}
					</>
				}
			/>
		</li>
	);
}

function OutputNode({
	node,
	workspaceId,
	onRemove,
	trailing,
}: {
	node: FileNode;
	workspaceId: string;
	onRemove: RequestRemoval;
	trailing?: ReactNode;
}) {
	const isDir = node.kind === "dir";
	const [expanded, setExpanded] = useState(false);
	const [children, setChildren] = useState<FileNode[] | null>(null);
	useWorkspaceRead(
		isDir && expanded ? workspaceId : null,
		(id) => getTransport().request("fs.readDir", { workspaceId: id, path: node.path }),
		{ onResult: (result) => setChildren(result), onFailure: () => setChildren([]) },
	);
	return (
		<>
			<EntryMenu
				workspaceId={workspaceId}
				path={node.path}
				deleted={false}
				onRemove={(path) => onRemove(path, false)}
			>
				{(menuOpen) => (
					<TreeRow
						testid="artifact-output-node"
						kind={isDir ? "dir" : "file"}
						expanded={expanded}
						highlighted={menuOpen}
						label={node.name}
						trailing={trailing}
						onClick={
							isDir
								? () => setExpanded((value) => !value)
								: firstClickOnly(() => void openFileInTab(workspaceId, node.path, "preview"))
						}
						onDoubleClick={
							isDir ? undefined : () => void openFileInTab(workspaceId, node.path, "keep")
						}
					/>
				)}
			</EntryMenu>
			{isDir && expanded ? (
				<ul className="flex flex-col pl-tree-indent">
					{children === null ? (
						<LoadingRegion rows={2} className="px-4 py-4" />
					) : (
						children.map((child) => (
							<li key={child.path}>
								<OutputNode node={child} workspaceId={workspaceId} onRemove={onRemove} />
							</li>
						))
					)}
				</ul>
			) : null}
		</>
	);
}

function EntryMenu({
	workspaceId,
	path,
	deleted,
	onRename,
	onRemove,
	onCloseAutoFocus,
	children,
}: {
	workspaceId: string;
	path: string;
	deleted: boolean;
	onRename?: () => void;
	onRemove: (path: string) => void;
	onCloseAutoFocus?: (event: Event) => void;
	children: (menuOpen: boolean) => ReactElement;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const canMention = useAppStore((s) => selectArtifactMentionTarget(s, workspaceId) !== null);
	const mutations = useAppStore((s) => supportsMoves(s.protocolVersion));
	const copyPath = (absolute: boolean) => {
		const worktreePath = selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath;
		void copyText(absolute ? joinWorkspacePath(worktreePath ?? "", path) : path);
	};
	const clip = (cut: boolean) =>
		useAppStore
			.getState()
			.setFileClipboard(cut ? { workspaceId, path, cut } : { workspaceId, path });
	return (
		<ContextMenu open={open} onOpenChange={setOpen}>
			<ContextMenuTrigger asChild onKeyDown={openContextMenuFromKeyboard}>
				{children(open)}
			</ContextMenuTrigger>
			<ContextMenuContent data-testid="artifact-actions" onCloseAutoFocus={onCloseAutoFocus}>
				{deleted ? (
					<ContextMenuItem
						data-testid="artifact-menu-restore"
						onSelect={() => void restoreArtifact(workspaceId, path)}
					>
						<RiArrowGoBackLine />
						{t("panels.artifacts.restore")}
					</ContextMenuItem>
				) : (
					<>
						<ContextMenuItem
							data-testid="artifact-mention"
							disabled={!canMention}
							title={canMention ? undefined : t("panels.artifacts.mentionNoChat")}
							onSelect={() => mentionArtifact(workspaceId, path)}
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
					</>
				)}
				<ContextMenuSeparator />
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
						{onRename ? (
							<ContextMenuItem data-testid="artifact-rename" onSelect={onRename}>
								<RiEditLine />
								{t("panels.artifacts.rename")}
							</ContextMenuItem>
						) : null}
					</>
				) : null}
				{mutations ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem
							data-testid="artifact-delete"
							className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
							onSelect={(event) => {
								event.preventDefault();
								setOpen(false);
								requestAnimationFrame(() => onRemove(path));
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

function RemovalDialog({
	workspaceId,
	request,
	onClose,
}: {
	workspaceId: string;
	request: RemovalRequest;
	onClose: () => void;
}) {
	const t = useT();
	const name = fileName(request.path);
	return (
		<ConfirmDialog
			open={request.open}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={
				request.kept
					? t("panels.artifacts.discardTitle", { name })
					: t("panels.fileTree.deleteTitle", { name })
			}
			description={
				request.kept
					? t("panels.artifacts.discardDescription", { path: request.path })
					: t("panels.fileTree.deleteDescription", { path: request.path })
			}
			confirmLabel={t("common.delete")}
			destructive
			confirmTestId="artifact-delete-confirm"
			onConfirm={() =>
				void (request.kept
					? discardArtifact(workspaceId, request.path)
					: deleteEntry(workspaceId, request.path))
			}
		/>
	);
}
