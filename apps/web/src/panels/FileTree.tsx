import type { FileNode } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { describeResource, PENDING_TEXT_META } from "@thinkrail/resource-renderers";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import { statusLetter } from "../chat/planView";
import { firstClickOnly } from "../lib";
import { selectFilesTreeView, selectWorkspaceById, type TabIntent, useAppStore } from "../store";
import { getTransport } from "../transport";
import { type ChangeMarks, statusMarkClass } from "./changesModel";
import { holdEditorWarm, useEditorWarm, warmOnHover } from "./editorWarm";
import { FileCopyMenu, fileTreeCopyRelativePath } from "./FileCopyMenu";
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

export function FileTree({
	workspaceId,
	marks,
	...focus
}: TreeFocus & { workspaceId: string; marks: ChangeMarks }) {
	const t = useT();
	const [nodes, setNodes] = useState<FileNode[] | null>(null);
	const worktreePath = useAppStore((s) => selectWorkspaceById(s, workspaceId)?.worktreePath ?? "");
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
	if (nodes.length === 0)
		return (
			<p className="px-4 py-4 tr-text-metadata text-text-muted">{t("panels.fileTree.empty")}</p>
		);
	return (
		<ul className="flex flex-col motion-safe:animate-reveal">
			{nodes.map((node) => (
				<FileNodeRow
					key={node.path}
					node={node}
					workspaceId={workspaceId}
					worktreePath={worktreePath}
					marks={marks}
					focus={focus}
					expandedPaths={expandedPaths}
					setPathsExpanded={setPathsExpanded}
					warmFile={warmFile}
				/>
			))}
		</ul>
	);
}

function FileNodeRow({
	node,
	workspaceId,
	worktreePath,
	marks,
	focus,
	expandedPaths,
	setPathsExpanded,
	warmFile,
}: {
	node: FileNode;
	workspaceId: string;
	worktreePath: string;
	marks: ChangeMarks;
	focus: TreeFocus;
	expandedPaths: ReadonlySet<string>;
	setPathsExpanded: SetPathsExpanded;
	warmFile: WarmFile;
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
		<li>
			<FileCopyMenu
				worktreePath={worktreePath}
				relativePath={fileTreeCopyRelativePath(node, directory)}
			>
				<TreeRow
					ref={revealRow}
					testid="file-node"
					kind={isDir ? "dir" : "file"}
					active={!isDir && focus.activePath === node.path}
					subtle={ignored}
					dataStatus={ignored ? "ignored" : undefined}
					expanded={expanded}
					label={label}
					labelClassName={
						fileStatus ? statusMarkClass(fileStatus) : dirChanged ? statusMarkClass("modified") : ""
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
									trigger === "focus" ? warmFile(node.path) : warmOnHover(() => warmFile(node.path))
					}
				/>
			</FileCopyMenu>
			{isDir && expanded && children && (
				<ul className="flex flex-col pl-tree-indent">
					{children.map((child) => (
						<FileNodeRow
							key={child.path}
							node={child}
							workspaceId={workspaceId}
							worktreePath={worktreePath}
							marks={marks}
							focus={focus}
							expandedPaths={expandedPaths}
							setPathsExpanded={setPathsExpanded}
							warmFile={warmFile}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
