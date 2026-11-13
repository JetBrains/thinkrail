import {
	RiFileCopyLine as Copy,
	RiFileCopy2Line as CopyEntry,
	RiScissorsCutLine as Cut,
	RiClipboardLine as Paste,
	RiDeleteBinLine as Trash,
} from "@remixicon/react";
import type { FileNode } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { describeResource, PENDING_TEXT_META } from "@thinkrail/resource-renderers";
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
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { statusLetter } from "../chat/planView";
import { copyText, fileName, firstClickOnly, joinWorkspacePath } from "../lib";
import {
	selectFilesTreeView,
	selectWorkspaceById,
	selectWorkspaceIsRunning,
	supportsArtifacts,
	type TabIntent,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { type ChangeMarks, statusMarkClass } from "./changesModel";
import { holdEditorWarm, useEditorWarm, warmOnHover } from "./editorWarm";
import { deleteEntry, pasteDestination, pasteInto, supportsFileMutations } from "./fileTreeActions";
import { type ResolvedFolderChain, resolveFolderChain } from "./folderChains";
import { openFileInTab } from "./openTabs";
import { TreeRow } from "./TreeRow";
import { useWorkspaceRead } from "./useWorkspaceRead";

type SetPathsExpanded = (paths: readonly string[], expanded: boolean) => void;
type WarmFile = ((path: string) => void) | undefined;
type RequestDelete = (path: string) => void;

interface DeleteRequest {
	path: string;
	open: boolean;
}

interface TreeFocus {
	activePath: string | null;
	revealTarget: string | null;
	onRevealed: () => void;
}

export function FileTree({
	workspaceId,
	marks,
	...focus
}: TreeFocus & { workspaceId: string; marks: ChangeMarks }) {
	const [nodes, setNodes] = useState<FileNode[] | null>(null);
	const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
	const expanded = useAppStore((s) => selectFilesTreeView(s, workspaceId).expanded);
	const expandedPaths = useMemo(() => new Set(expanded), [expanded]);
	const warm = useEditorWarm();
	const warmFile: WarmFile = warm
		? (path) => warm(describeResource(workspaceId, path, PENDING_TEXT_META))
		: undefined;

	const setPathsExpanded: SetPathsExpanded = (paths, next) =>
		useAppStore.getState().setFilesTreeExpanded(workspaceId, paths, next);

	useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("fs.readDir", { workspaceId: id, path: "." }),
		{
			onResult: (result) => setNodes(result),
			onFailure: () => setNodes((prev) => prev ?? []),
			onSwitch: () => setNodes(null),
		},
	);

	const loading = nodes === null;
	useEffect(() => (loading ? holdEditorWarm() : undefined), [loading]);

	if (nodes === null) return <LoadingRegion rows={8} className="px-4 py-4" />;
	if (nodes.length === 0) return <EmptyTree workspaceId={workspaceId} />;
	return (
		<>
			<ul data-focus-list="files" className="flex flex-col motion-safe:animate-reveal">
				{nodes.map((node) => (
					<FileNodeRow
						key={node.path}
						node={node}
						workspaceId={workspaceId}
						marks={marks}
						focus={focus}
						expandedPaths={expandedPaths}
						setPathsExpanded={setPathsExpanded}
						warmFile={warmFile}
						onDelete={(path) => setDeleteRequest({ path, open: true })}
					/>
				))}
			</ul>
			{deleteRequest ? (
				<DeleteEntryDialog
					workspaceId={workspaceId}
					request={deleteRequest}
					onClose={() => setDeleteRequest({ ...deleteRequest, open: false })}
				/>
			) : null}
		</>
	);
}

function EmptyTree({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const canPaste = useAppStore(
		(s) => supportsFileMutations(s.protocolVersion) && s.fileClipboard !== null,
	);
	return (
		<div className="flex items-center gap-8 px-4 py-4">
			<p className="tr-text-metadata text-text-muted">{t("panels.fileTree.empty")}</p>
			{canPaste ? (
				<Button
					variant="ghost"
					size="s"
					iconLeft={Paste}
					data-testid="file-tree-paste-root"
					onClick={() => void pasteInto(workspaceId, ".")}
				>
					{t("panels.fileTree.paste")}
				</Button>
			) : null}
		</div>
	);
}

function DeleteEntryDialog({
	workspaceId,
	request,
	onClose,
}: {
	workspaceId: string;
	request: DeleteRequest;
	onClose: () => void;
}) {
	const t = useT();
	const agentWorking = useAppStore((s) => selectWorkspaceIsRunning(s, workspaceId));
	return (
		<ConfirmDialog
			open={request.open}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title={t("panels.fileTree.deleteTitle", { name: fileName(request.path) })}
			description={
				<>
					{t("panels.fileTree.deleteDescription", { path: request.path })}
					{agentWorking ? (
						<span data-testid="file-tree-delete-agent-working" className="mt-4 block">
							{t("panels.fileTree.deleteAgentWorking")}
						</span>
					) : null}
				</>
			}
			confirmLabel={t("common.delete")}
			destructive
			confirmTestId="file-tree-delete-confirm"
			onConfirm={() => void deleteEntry(workspaceId, request.path)}
		/>
	);
}

function FileNodeRow({
	node,
	workspaceId,
	marks,
	focus,
	expandedPaths,
	setPathsExpanded,
	warmFile,
	onDelete,
}: {
	node: FileNode;
	workspaceId: string;
	marks: ChangeMarks;
	focus: TreeFocus;
	expandedPaths: ReadonlySet<string>;
	setPathsExpanded: SetPathsExpanded;
	warmFile: WarmFile;
	onDelete: RequestDelete;
}) {
	const isDir = node.kind === "dir";
	const [directory, setDirectory] = useState<ResolvedFolderChain<FileNode> | null>(null);
	const pendingExpand = useRef(false);

	const { reload } = useWorkspaceRead(
		isDir ? workspaceId : null,
		(id) =>
			resolveFolderChain(node, (path) =>
				getTransport().request("fs.readDir", { workspaceId: id, path }),
			),
		{
			onResult: (result) => {
				setDirectory(result);
				if (!pendingExpand.current) return;
				pendingExpand.current = false;
				setPathsExpanded(result.paths, true);
			},
			onSwitch: () => {
				pendingExpand.current = false;
				setDirectory(null);
			},
		},
	);

	const label = directory?.label ?? node.name;
	const representedPaths = directory?.paths ?? [node.path];
	const expanded = expandedPaths.has(directory?.path ?? node.path);
	const children = directory?.children ?? null;
	const toggleDirectory = () => {
		const nextExpanded = !expanded;
		pendingExpand.current = nextExpanded && directory === null;
		setPathsExpanded(representedPaths, nextExpanded);
		if (nextExpanded) reload();
	};
	const open = (intent: TabIntent) => void openFileInTab(workspaceId, node.path, intent);
	const fileStatus = isDir ? undefined : marks.files.get(node.path);
	const dirChanged = isDir && marks.dirs.has(directory?.path ?? node.path);
	const ignored = (directory?.deepest ?? node).gitignored === true;
	const revealRow =
		!isDir && focus.revealTarget === node.path
			? (row: HTMLButtonElement | null) => {
					if (!row) return;
					row.scrollIntoView({ block: "nearest" });
					focus.onRevealed();
				}
			: undefined;

	return (
		<li data-focus-row={node.path}>
			<FileTreeMenu
				workspaceId={workspaceId}
				path={directory?.path ?? node.path}
				kind={node.kind}
				onDelete={onDelete}
			>
				{(menuOpen) => (
					<TreeRow
						ref={revealRow}
						testid="file-node"
						path={directory?.path ?? node.path}
						kind={isDir ? "dir" : "file"}
						active={!isDir && focus.activePath === node.path}
						highlighted={menuOpen}
						subtle={ignored}
						dataStatus={ignored ? "ignored" : undefined}
						expanded={expanded}
						label={label}
						labelClassName={
							fileStatus
								? statusMarkClass(fileStatus)
								: dirChanged
									? statusMarkClass("modified")
									: ""
						}
						trailing={
							fileStatus ? (
								<span
									data-testid="file-status"
									className={`shrink-0 tr-text-metadata ${statusMarkClass(fileStatus)}`}
								>
									{statusLetter(fileStatus)}
								</span>
							) : dirChanged ? (
								<span
									data-testid="file-folder-dot"
									className="mr-4 size-6 shrink-0 rounded-full bg-feedback-warning"
								/>
							) : undefined
						}
						onClick={isDir ? toggleDirectory : firstClickOnly(() => open("preview"))}
						onDoubleClick={isDir ? undefined : () => open("keep")}
						onWarm={
							isDir || !warmFile
								? undefined
								: (trigger) =>
										trigger === "focus"
											? warmFile(node.path)
											: warmOnHover(() => warmFile(node.path))
						}
					/>
				)}
			</FileTreeMenu>
			{isDir && expanded && children && (
				<ul
					data-focus-list={`files:${directory?.path ?? node.path}`}
					className="flex flex-col pl-tree-indent"
				>
					{children.map((child) => (
						<FileNodeRow
							key={child.path}
							node={child}
							workspaceId={workspaceId}
							marks={marks}
							focus={focus}
							expandedPaths={expandedPaths}
							setPathsExpanded={setPathsExpanded}
							warmFile={warmFile}
							onDelete={onDelete}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function FileTreeMenu({
	workspaceId,
	path,
	kind,
	onDelete,
	children,
}: {
	workspaceId: string;
	path: string;
	kind: FileNode["kind"];
	onDelete: RequestDelete;
	children: (menuOpen: boolean) => ReactElement;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const mutations = useAppStore((s) => supportsFileMutations(s.protocolVersion));
	const moves = useAppStore((s) => supportsArtifacts(s.protocolVersion));
	const canPaste = useAppStore((s) => s.fileClipboard !== null);
	const copyPath = (absolute: boolean) => {
		const worktreePath = selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath;
		void copyText(absolute ? joinWorkspacePath(worktreePath ?? "", path) : path);
	};
	return (
		<ContextMenu open={open} onOpenChange={setOpen}>
			<ContextMenuTrigger asChild onKeyDown={openContextMenuFromKeyboard}>
				{children(open)}
			</ContextMenuTrigger>
			<ContextMenuContent data-testid="file-tree-actions">
				<ContextMenuItem data-testid="file-copy-path" onSelect={() => copyPath(true)}>
					<Copy />
					{t("panels.fileTree.copyPath")}
				</ContextMenuItem>
				<ContextMenuItem data-testid="file-copy-relative-path" onSelect={() => copyPath(false)}>
					<Copy />
					{t("panels.fileTree.copyRelativePath")}
				</ContextMenuItem>
				{mutations ? (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem
							data-testid="file-tree-copy"
							onSelect={() => useAppStore.getState().setFileClipboard({ workspaceId, path })}
						>
							<CopyEntry />
							{t("common.copy")}
						</ContextMenuItem>
						{moves ? (
							<ContextMenuItem
								data-testid="file-tree-cut"
								onSelect={() =>
									useAppStore.getState().setFileClipboard({ workspaceId, path, cut: true })
								}
							>
								<Cut />
								{t("panels.fileTree.cut")}
							</ContextMenuItem>
						) : null}
						{canPaste ? (
							<ContextMenuItem
								data-testid="file-tree-paste"
								onSelect={() => void pasteInto(workspaceId, pasteDestination(path, kind))}
							>
								<Paste />
								{t("panels.fileTree.paste")}
							</ContextMenuItem>
						) : null}
						<ContextMenuSeparator />
						<ContextMenuItem
							data-testid="file-tree-delete"
							className="text-feedback-error focus:bg-feedback-error-subtle [&_svg]:text-feedback-error"
							onSelect={(event) => {
								event.preventDefault();
								setOpen(false);
								requestAnimationFrame(() => onDelete(path));
							}}
						>
							<Trash />
							{t("common.delete")}
						</ContextMenuItem>
					</>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}
