import {
	RiFolderOpenLine as AbsolutePath,
	RiFileCopyLine as Copy,
	RiClipboardLine as Paste,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import type { FileNode } from "@thinkrail/contracts";
import { FS_MUTATIONS_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { describeResource, PENDING_TEXT_META } from "@thinkrail/resource-renderers";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { statusLetter } from "../chat/planView";
import { copyText, firstClickOnly, joinHostPath } from "../lib";
import {
	selectFilesTreeView,
	selectWorkspaceById,
	type TabIntent,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";
import { type ChangeMarks, statusMarkClass } from "./changesModel";
import { holdEditorWarm, useEditorWarm, warmOnHover } from "./editorWarm";
import { type ResolvedFolderChain, resolveFolderChain } from "./folderChains";
import { openFileInTab } from "./openTabs";
import { TreeRow } from "./TreeRow";
import { useWorkspaceRead } from "./useWorkspaceRead";

type SetPathsExpanded = (paths: readonly string[], expanded: boolean) => void;
type WarmFile = ((path: string) => void) | undefined;

interface TreeFocus {
	activePath: string | null;
	revealTarget: string | null;
	onRevealed: () => void;
}

interface DeleteTarget {
	path: string;
	name: string;
}

interface TreeActions {
	supported: boolean;
	worktreePath: string;
	clipboard: { workspaceId: string; path: string } | null;
	copyFile: (path: string) => void;
	pasteFile: (directory: string) => void;
	deleteFile: (target: DeleteTarget) => void;
}

function parentPath(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "." : path.slice(0, slash);
}

export function FileTree({
	workspaceId,
	marks,
	...focus
}: TreeFocus & { workspaceId: string; marks: ChangeMarks }) {
	const t = useT();
	const [nodes, setNodes] = useState<FileNode[] | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
	const expanded = useAppStore((s) => selectFilesTreeView(s, workspaceId).expanded);
	const worktreePath = useAppStore((s) => selectWorkspaceById(s, workspaceId)?.worktreePath ?? "");
	const supported = useAppStore(
		(s) => s.protocolVersion !== null && s.protocolVersion >= FS_MUTATIONS_PROTOCOL_VERSION,
	);
	const clipboard = useAppStore((s) => s.fileClipboard);
	const expandedPaths = useMemo(() => new Set(expanded), [expanded]);
	const warm = useEditorWarm();
	const warmFile: WarmFile = warm
		? (path) => warm(describeResource(workspaceId, path, PENDING_TEXT_META))
		: undefined;

	const setPathsExpanded: SetPathsExpanded = (paths, next) =>
		useAppStore.getState().setFilesTreeExpanded(workspaceId, paths, next);
	const actions: TreeActions = {
		supported,
		worktreePath,
		clipboard,
		copyFile: (path) => useAppStore.getState().setFileClipboard({ workspaceId, path }),
		pasteFile: (destinationDirectory) => {
			const source = useAppStore.getState().fileClipboard;
			if (!source) return;
			void getTransport()
				.request("fs.copy", {
					sourceWorkspaceId: source.workspaceId,
					sourcePath: source.path,
					destinationWorkspaceId: workspaceId,
					destinationDirectory,
				})
				.catch((error) => toast.error(errorText(error), t("panels.fileTree.pasteFailed")));
		},
		deleteFile: setDeleteTarget,
	};

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
	if (nodes.length === 0) return <EmptyTree actions={actions} />;
	return (
		<>
			<ul className="flex flex-col motion-safe:animate-reveal">
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
						actions={actions}
					/>
				))}
			</ul>
			<ConfirmDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
				title={t("panels.fileTree.deleteTitle", { name: deleteTarget?.name ?? "" })}
				description={t("panels.fileTree.deleteDescription")}
				confirmLabel={t("common.delete")}
				destructive
				confirmTestId="file-tree-delete-confirm"
				onConfirm={() => {
					if (!deleteTarget) return;
					const target = deleteTarget;
					void getTransport()
						.request("fs.delete", { workspaceId, path: target.path })
						.then(() => {
							const store = useAppStore.getState();
							if (
								store.fileClipboard?.workspaceId === workspaceId &&
								store.fileClipboard.path === target.path
							) {
								store.setFileClipboard(null);
							}
						})
						.catch((error) => toast.error(errorText(error), t("panels.fileTree.deleteFailed")));
				}}
			/>
		</>
	);
}

function EmptyTree({ actions }: { actions: TreeActions }) {
	const t = useT();
	const row = (
		<p className="px-4 py-4 tr-text-metadata text-text-muted">{t("panels.fileTree.empty")}</p>
	);
	if (!actions.supported || !actions.clipboard) return row;
	return (
		<FileTreeMenu path="." kind="dir" actions={actions} showPathActions={false}>
			{row}
		</FileTreeMenu>
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
	actions,
}: {
	node: FileNode;
	workspaceId: string;
	marks: ChangeMarks;
	focus: TreeFocus;
	expandedPaths: ReadonlySet<string>;
	setPathsExpanded: SetPathsExpanded;
	warmFile: WarmFile;
	actions: TreeActions;
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
	const menuPath = directory?.path ?? node.path;
	const revealRow =
		!isDir && focus.revealTarget === node.path
			? (row: HTMLButtonElement | null) => {
					if (!row) return;
					row.scrollIntoView({ block: "nearest" });
					focus.onRevealed();
				}
			: undefined;

	return (
		<li>
			<FileTreeMenu path={menuPath} kind={isDir ? "dir" : "file"} actions={actions}>
				{(menuOpen) => (
					<TreeRow
						ref={revealRow}
						testid="file-node"
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
				<ul className="flex flex-col pl-tree-indent">
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
							actions={actions}
						/>
					))}
				</ul>
			)}
		</li>
	);
}

function FileTreeMenu({
	path,
	kind,
	actions,
	children,
	showPathActions = true,
}: {
	path: string;
	kind: "dir" | "file";
	actions: TreeActions;
	children: ReactNode | ((open: boolean) => ReactNode);
	showPathActions?: boolean;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const trigger = typeof children === "function" ? children(open) : children;
	const destination = kind === "dir" ? path : parentPath(path);
	const copyPath = (value: string) => {
		void copyText(value).then((copied) => {
			if (!copied) toast.error(t("panels.fileTree.copyPathFailed"));
		});
	};
	return (
		<ContextMenu open={open} onOpenChange={setOpen}>
			<ContextMenuTrigger
				asChild
				onKeyDown={(event) => {
					if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
					event.preventDefault();
					const rect = event.currentTarget.getBoundingClientRect();
					event.currentTarget.dispatchEvent(
						new MouseEvent("contextmenu", {
							bubbles: true,
							clientX: rect.left,
							clientY: rect.bottom,
						}),
					);
				}}
			>
				{trigger}
			</ContextMenuTrigger>
			<ContextMenuContent data-testid="file-tree-actions">
				{showPathActions ? (
					<>
						<ContextMenuItem data-testid="file-tree-copy-relative" onSelect={() => copyPath(path)}>
							<Copy />
							{t("panels.fileTree.copyRelativePath")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="file-tree-copy-absolute"
							onSelect={() => copyPath(joinHostPath(actions.worktreePath, path))}
						>
							<AbsolutePath />
							{t("panels.fileTree.copyAbsolutePath")}
						</ContextMenuItem>
					</>
				) : null}
				{showPathActions && actions.supported && (kind === "file" || actions.clipboard) ? (
					<ContextMenuSeparator />
				) : null}
				{actions.supported && kind === "file" ? (
					<ContextMenuItem data-testid="file-tree-copy" onSelect={() => actions.copyFile(path)}>
						<Copy />
						{t("common.copy")}
					</ContextMenuItem>
				) : null}
				{actions.supported && actions.clipboard ? (
					<ContextMenuItem
						data-testid="file-tree-paste"
						onSelect={() => actions.pasteFile(destination)}
					>
						<Paste />
						{t("panels.fileTree.paste")}
					</ContextMenuItem>
				) : null}
				{actions.supported && kind === "file" ? <ContextMenuSeparator /> : null}
				{actions.supported && kind === "file" ? (
					<ContextMenuItem
						data-testid="file-tree-delete"
						className="text-feedback-error focus:bg-feedback-error-subtle focus:text-feedback-error [&_svg]:text-feedback-error"
						onSelect={(event) => {
							event.preventDefault();
							setOpen(false);
							requestAnimationFrame(() =>
								actions.deleteFile({ path, name: path.split("/").at(-1) ?? path }),
							);
						}}
					>
						<Trash2 />
						{t("common.delete")}
					</ContextMenuItem>
				) : null}
			</ContextMenuContent>
		</ContextMenu>
	);
}
