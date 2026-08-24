import type { FileNode } from "@thinkrail/contracts";
import { useRef, useState } from "react";
import { SkeletonRows } from "../components/Skeleton";
import type { TabIntent } from "../store";
import { getTransport } from "../transport";
import { type ResolvedFolderChain, resolveFolderChain } from "./folderChains";
import { openFileInTab } from "./openTabs";
import { TreeRow } from "./TreeRow";
import { useWorkspaceRead } from "./useWorkspaceRead";

type SetPathsExpanded = (paths: readonly string[], expanded: boolean) => void;

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
		return (
			<div className="px-xs py-xs">
				<SkeletonRows rows={8} />
			</div>
		);
	if (nodes.length === 0)
		return <p className="px-4 py-4 tr-text-metadata text-text-muted">Empty</p>;
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
				<ul className="flex flex-col pl-12">
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
