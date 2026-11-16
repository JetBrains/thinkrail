import {
	RiClipboardLine,
	RiCollapseVerticalLine,
	RiEyeLine,
	RiEyeOffLine,
	RiRefreshLine,
	RiShapesLine,
} from "@remixicon/react";
import type { FileNode } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { QuietScrollArea } from "@/components/QuietScrollArea";
import { fileName, firstClickOnly } from "../lib";
import {
	artifactsWatermark,
	hostLacksArtifacts,
	selectActiveFilePath,
	supportsArtifacts,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { ArtifactTreeRows } from "./ArtifactsTree";
import {
	discardArtifact,
	openArtifact,
	restoreDeletedArtifact,
	selectArtifactMentionTarget,
} from "./artifactActions";
import {
	ArtifactEntryMenu,
	artifactIcon,
	ChatChip,
	NewDot,
	type RequestRemoval,
} from "./artifactRowParts";
import {
	type ArtifactRow,
	artifactRows,
	artifactTimeLabel,
	artifactTree,
	type OutputRow,
} from "./artifactsModel";
import { ConfirmDialog } from "./ConfirmDialog";
import { deleteEntry, pasteInto, renameEntry } from "./fileTreeActions";
import { HeaderIconButton } from "./HeaderIconButton";
import { openFileInTab } from "./openTabs";
import { TreeRow } from "./TreeRow";
import { Tree, treeRowControlProps, useTreeItem } from "./treeNavigation";
import { useWorkspaceRead } from "./useWorkspaceRead";
import { useInlineRename } from "./workspaceActions";

interface RemovalRequest {
	path: string;
	kept: boolean;
	open: boolean;
}

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
	const unsupported = useAppStore((s) => hostLacksArtifacts(s.protocolVersion));
	const snapshot = useAppStore((s) => s.artifactsByWorkspace[workspaceId]);
	const specs = useAppStore((s) => s.specsByWorkspace[workspaceId]);
	const showIgnored = useAppStore((s) => s.artifactsShowIgnored);
	const mentionTarget = useAppStore((s) => selectArtifactMentionTarget(s, workspaceId));
	const canPaste = useAppStore(
		(s) => supportsArtifacts(s.protocolVersion) && s.fileClipboard !== null,
	);
	const view = useAppStore((s) => s.artifactsView);
	const expandedPaths = useAppStore((s) => s.artifactsTreeExpandedByWorkspace[workspaceId]);
	const activePath = useAppStore((s) => selectActiveFilePath(s, workspaceId));
	const [allChats, setAllChats] = useState(false);
	const [highlightSince, setHighlightSince] = useState<number | null>(null);
	const [removal, setRemoval] = useState<RemovalRequest | null>(null);

	useEffect(() => {
		if (!snapshot) return;
		const store = useAppStore.getState();
		if (highlightSince === null)
			setHighlightSince(store.artifactsSeenByWorkspace[workspaceId] ?? 0);
		store.markArtifactsSeen(workspaceId, artifactsWatermark(snapshot, showIgnored));
	}, [snapshot, workspaceId, highlightSince, showIgnored]);

	const sessionId = allChats ? null : mentionTarget;
	const rows = useMemo(
		() =>
			snapshot && highlightSince !== null
				? artifactRows(snapshot, { sessionId, highlightSince, showIgnored, specs })
				: null,
		[snapshot, sessionId, highlightSince, showIgnored, specs],
	);
	const tree = useMemo(
		() => (view === "tree" && snapshot && rows ? artifactTree(snapshot.dir, rows.artifacts) : null),
		[view, snapshot, rows],
	);
	const expanded = useMemo(() => new Set(expandedPaths), [expandedPaths]);
	const requestRemoval: RequestRemoval = (path, kept) => setRemoval({ path, kept, open: true });
	const openKept = (path: string) => void openFileInTab(workspaceId, path, "keep");
	const openArtifactKept = (path: string) => {
		const artifact = snapshot?.artifacts.find((entry) => entry.path === path);
		if (artifact) void openArtifact(workspaceId, artifact, "keep");
	};

	if (unsupported) {
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
					active={sessionId === null}
					onClick={() => setAllChats(true)}
				/>
				<ToggleSegment
					testid="artifacts-filter-chat"
					label={t("panels.artifacts.thisChat")}
					active={sessionId !== null}
					disabled={mentionTarget === null}
					onClick={() => setAllChats(false)}
				/>
				<div className="ml-auto flex shrink-0 items-center gap-4">
					<ToggleSegment
						testid="artifacts-view-list"
						label={t("panels.artifacts.viewList")}
						active={view === "list"}
						onClick={() => useAppStore.getState().setArtifactsView("list")}
					/>
					<ToggleSegment
						testid="artifacts-view-tree"
						label={t("panels.artifacts.viewTree")}
						active={view === "tree"}
						onClick={() => useAppStore.getState().setArtifactsView("tree")}
					/>
					{view === "tree" && expanded.size > 0 ? (
						<HeaderIconButton
							testid="artifacts-collapse-all"
							label={t("panels.artifacts.collapseAll")}
							icon={RiCollapseVerticalLine}
							onClick={() => useAppStore.getState().collapseAllArtifacts(workspaceId)}
						/>
					) : null}
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
			<QuietScrollArea
				data-focus-default
				className="min-h-0 flex-1"
				viewportClassName="p-panel-inset"
			>
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
					<>
						<EmptyArtifacts onlyThisChat={sessionId !== null} />
						<OtherChats count={rows.otherChats} onShow={() => setAllChats(true)} />
					</>
				) : (
					<div className="flex flex-col gap-8 motion-safe:animate-reveal">
						{rows.artifacts.length > 0 ? (
							<Section
								testid="artifacts-section"
								focusList="artifacts"
								title={t("panels.artifacts.sectionArtifacts")}
								label={t("panels.artifacts.artifactsTree")}
								count={rows.artifacts.length}
								onOpenKept={openArtifactKept}
							>
								{tree ? (
									<ArtifactTreeRows
										nodes={tree}
										workspaceId={workspaceId}
										expanded={expanded}
										activePath={activePath}
										showChat={sessionId === null}
										onRemove={requestRemoval}
									/>
								) : (
									rows.artifacts.map((row) => (
										<ArtifactRowView
											key={row.artifact.path}
											row={row}
											workspaceId={workspaceId}
											active={activePath === row.artifact.path}
											onRemove={requestRemoval}
										/>
									))
								)}
							</Section>
						) : null}
						{rows.outputs?.length ? (
							<Section
								testid="artifacts-outputs-section"
								focusList="artifacts-outputs"
								title={t("panels.artifacts.sectionOutputs")}
								label={t("panels.artifacts.outputsTree")}
								count={rows.outputs.length}
								focusDefault={rows.artifacts.length === 0}
								onOpenKept={openKept}
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
						<OtherChats count={rows.otherChats} onShow={() => setAllChats(true)} />
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

function OtherChats({ count, onShow }: { count: number; onShow: () => void }) {
	const t = useT();
	if (count === 0) return null;
	return (
		<p
			data-testid="artifacts-other-chats"
			className="flex items-center justify-center gap-8 px-4 text-text-subtle tr-text-metadata"
		>
			<span>{t("panels.artifacts.otherChats", { count })}</span>
			<button
				type="button"
				data-testid="artifacts-show-all"
				onClick={onShow}
				className="text-primary hover:underline"
			>
				{t("panels.artifacts.showAllChats")}
			</button>
		</p>
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
	focusList,
	title,
	label,
	count,
	focusDefault = true,
	onOpenKept,
	children,
}: {
	testid: string;
	focusList: string;
	title: string;
	label: string;
	count: number;
	focusDefault?: boolean;
	onOpenKept: (path: string) => void;
	children: ReactNode;
}) {
	return (
		<section data-testid={testid} className="flex flex-col">
			<h3 className="flex items-center justify-between px-4 pb-4 text-text-subtle tr-text-metadata">
				<span>{title}</span>
				<span>{count}</span>
			</h3>
			<Tree
				label={label}
				focusList={focusList}
				className="flex flex-col"
				focusDefault={focusDefault}
				onOpenKept={onOpenKept}
			>
				{children}
			</Tree>
		</section>
	);
}

function ArtifactRowView({
	row,
	workspaceId,
	active,
	onRemove,
}: {
	row: ArtifactRow;
	workspaceId: string;
	active: boolean;
	onRemove: RequestRemoval;
}) {
	const t = useT();
	const { artifact, name, folder, taskSpecStatus, fresh } = row;
	const deleted = artifact.state === "deleted";
	const { editing, nameRef, start, inputProps, onMenuCloseAutoFocus } = useInlineRename({
		target: { id: artifact.path, name },
		canRename: !deleted,
		onRename: (_target, next) => void renameEntry(workspaceId, artifact.path, next),
	});
	const Icon = artifactIcon(row);
	const restore = () => void restoreDeletedArtifact(workspaceId, artifact);
	const open = (intent: "preview" | "keep") => void openArtifact(workspaceId, artifact, intent);
	const treeItem = useTreeItem(artifact.path, {
		level: 1,
		label: name,
		selected: active,
		openKept: true,
	});
	const detail =
		taskSpecStatus !== null
			? t("panels.artifacts.taskSpec", { status: taskSpecStatus || "—" })
			: folder;
	return (
		<li
			role="none"
			data-testid="artifact-row"
			data-path={artifact.path}
			data-focus-row={artifact.path}
			data-state={artifact.state}
			data-fresh={fresh || undefined}
		>
			<ArtifactEntryMenu
				workspaceId={workspaceId}
				path={artifact.path}
				deleted={deleted}
				onRestore={restore}
				sessionId={artifact.sessionId}
				onRename={start}
				onRemove={(path) => onRemove(path, deleted)}
				onCloseAutoFocus={onMenuCloseAutoFocus}
			>
				{(menuOpen, onRowKeyDown) => (
					<div
						role="none"
						title={artifactTimeLabel(t, artifact.changedAt)}
						className={cn(
							"flex w-full min-w-0 items-start gap-8 rounded-sm px-4 py-4",
							menuOpen || active ? "bg-control-bg-selected" : "hover:bg-control-bg-hovered",
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
										{...treeItem}
										data-testid="artifact-open"
										data-focus-row-primary
										onClick={firstClickOnly(() => open("preview"))}
										onDoubleClick={() => open("keep")}
										onKeyDown={onRowKeyDown}
										className={cn(
											"min-w-0 flex-1 truncate text-left tr-text-ui focus-visible:focus-ring-inset",
											deleted ? "text-text-subtle line-through" : "text-text-default",
										)}
									>
										{name}
									</button>
								)}
								{fresh ? <NewDot /> : null}
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
											{...treeRowControlProps}
											onClick={restore}
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
			</ArtifactEntryMenu>
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
		<li
			role="none"
			data-testid="artifact-output"
			data-path={output.path}
			data-focus-row={output.path}
			data-fresh={fresh || undefined}
		>
			<OutputNode
				node={node}
				level={1}
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
	level,
	workspaceId,
	onRemove,
	trailing,
}: {
	node: FileNode;
	level: number;
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
			<ArtifactEntryMenu
				workspaceId={workspaceId}
				path={node.path}
				onRemove={(path) => onRemove(path, false)}
			>
				{(menuOpen, onRowKeyDown) => (
					<TreeRow
						testid="artifact-output-node"
						treeId={node.path}
						level={level}
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
						onKeyDown={onRowKeyDown}
					/>
				)}
			</ArtifactEntryMenu>
			{isDir && expanded ? (
				<ul
					role="none"
					data-focus-list={`artifacts-outputs:${node.path}`}
					className="flex flex-col pl-tree-indent"
				>
					{children === null ? (
						<li role="none">
							<LoadingRegion rows={2} className="px-4 py-4" />
						</li>
					) : (
						children.map((child) => (
							<li key={child.path} role="none" data-focus-row={child.path}>
								<OutputNode
									node={child}
									level={level + 1}
									workspaceId={workspaceId}
									onRemove={onRemove}
								/>
							</li>
						))
					)}
				</ul>
			) : null}
		</>
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
