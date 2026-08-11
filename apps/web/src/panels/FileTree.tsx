import type { FileNode } from "@thinkrail/contracts";
import { useRef, useState } from "react";
import type { TabIntent } from "../store";
import { getTransport } from "../transport";
import { type ResolvedFolderChain, resolveFolderChain } from "./folderChains";
import { openFileInTab } from "./openTabs";
import { TreeRow } from "./TreeRow";
import { useWorkspaceRead } from "./useWorkspaceRead";

type SetPathsExpanded = (paths: readonly string[], expanded: boolean) => void;

/**
 * Lazy file tree of the active worktree. Single-click a file to **preview** it in the workspace's one
 * reusable center tab (browsing never piles tabs up); double-click to keep it as a tab of its own.
 * Single-directory runs render as one slash-joined row. Visible directory rows probe only along that run;
 * expanding the compact row mounts the deepest directory's children. Live: the store's per-workspace fs
 * tick (the host's `workspace.fsChanged` nudge) silently refetches the root and visible runs — expansion,
 * keys, and scroll survive; a refetch failure keeps the last good listing.
 */
export function FileTree({ workspaceId }: { workspaceId: string }) {
	const [nodes, setNodes] = useState<FileNode[] | null>(null);
	const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());

	const setPathsExpanded: SetPathsExpanded = (paths, expanded) => {
		setExpandedPaths((current) => {
			const next = new Set(current);
			for (const path of paths) {
				if (expanded) next.add(path);
				else next.delete(path);
			}
			return next;
		});
	};

	// The root listing, re-read on the workspace's fs tick; a switch clears the old tree, a failed re-read
	// keeps it (and a failed *first* read shows an empty tree rather than a permanent "Loading…").
	useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("fs.readDir", { workspaceId: id, path: "." }),
		{
			onResult: (result) => setNodes(result),
			onFailure: () => setNodes((prev) => prev ?? []),
			onSwitch: () => setNodes(null),
		},
	);

	if (nodes === null)
		return <p className="px-xs py-xs tr-text-metadata text-text-muted">Loading…</p>;
	if (nodes.length === 0)
		return <p className="px-xs py-xs tr-text-metadata text-text-muted">Empty</p>;
	return (
		<ul className="flex flex-col">
			{nodes.map((node) => (
				<FileNodeRow
					key={node.path}
					node={node}
					workspaceId={workspaceId}
					expandedPaths={expandedPaths}
					setPathsExpanded={setPathsExpanded}
				/>
			))}
		</ul>
	);
}

function FileNodeRow({
	node,
	workspaceId,
	expandedPaths,
	setPathsExpanded,
}: {
	node: FileNode;
	workspaceId: string;
	expandedPaths: ReadonlySet<string>;
	setPathsExpanded: SetPathsExpanded;
}) {
	const isDir = node.kind === "dir";
	const [directory, setDirectory] = useState<ResolvedFolderChain<FileNode> | null>(null);
	// Covers the brief window where a user expands a row before its eager chain probe resolves: once the
	// represented paths are known, the expansion intent is applied to all of them.
	const pendingExpand = useRef(false);

	// A visible directory follows only its run of single-directory children, even while collapsed, so the
	// compact label is available without making the user expand every segment. The deepest listing doubles
	// as the children mounted on expansion; a branch ends the probe, so collapsed subtrees are never walked.
	// Every fs tick re-resolves the run and a failure keeps the last good shape. Expanding also retries the
	// read, preserving the tree's manual recovery path if the eager probe hit a transient failure.
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

	return (
		<li>
			<TreeRow
				testid="file-node"
				kind={isDir ? "dir" : "file"}
				expanded={expanded}
				label={label}
				onClick={isDir ? toggleDirectory : () => open("preview")}
				onDoubleClick={isDir ? undefined : () => open("keep")}
			/>
			{isDir && expanded && children && (
				<ul className="flex flex-col pl-md">
					{children.map((child) => (
						<FileNodeRow
							key={child.path}
							node={child}
							workspaceId={workspaceId}
							expandedPaths={expandedPaths}
							setPathsExpanded={setPathsExpanded}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
