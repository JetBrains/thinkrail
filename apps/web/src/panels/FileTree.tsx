import type { FileNode } from "@thinkrail/contracts";
import { useState } from "react";
import type { TabIntent } from "../store";
import { getTransport } from "../transport";
import { openFileInTab } from "./openTabs";
import { TreeRow } from "./TreeRow";
import { useWorkspaceRead } from "./useWorkspaceRead";

/**
 * Lazy file tree of the active worktree. Single-click a file to **preview** it in the workspace's one
 * reusable center tab (browsing never piles tabs up); double-click to keep it as a tab of its own.
 * Live: the store's per-workspace fs tick (the host's `workspace.fsChanged` nudge) silently refetches
 * the root and every expanded dir — expansion, keys, and scroll survive; a refetch failure keeps the
 * last good listing.
 */
export function FileTree({ workspaceId }: { workspaceId: string }) {
	const [nodes, setNodes] = useState<FileNode[] | null>(null);

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
		return <p className="px-xs py-xs tr-text-metadata text-text-subtle">Loading…</p>;
	if (nodes.length === 0)
		return <p className="px-xs py-xs tr-text-metadata text-text-subtle">Empty</p>;
	return (
		<ul className="flex flex-col">
			{nodes.map((node) => (
				<FileNodeRow key={node.path} node={node} workspaceId={workspaceId} />
			))}
		</ul>
	);
}

function FileNodeRow({ node, workspaceId }: { node: FileNode; workspaceId: string }) {
	const isDir = node.kind === "dir";
	const [expanded, setExpanded] = useState(false);
	const [children, setChildren] = useState<FileNode[] | null>(null);

	// An expanded dir (re-)reads its listing on expansion AND on every fs tick, silently keeping the
	// previous children on failure (e.g. the dir vanished — the parent's own re-read drops this row).
	// Collapsed reads nothing: `null` is the shared hook's "no workspace to read for", which is exactly the
	// paused state here — so the row needs no tick prop threaded down from the tree.
	useWorkspaceRead(
		isDir && expanded ? workspaceId : null,
		(id) => getTransport().request("fs.readDir", { workspaceId: id, path: node.path }),
		{
			onResult: (result) => setChildren(result),
			onFailure: () => setChildren((prev) => prev ?? []),
		},
	);

	const open = (intent: TabIntent) => void openFileInTab(workspaceId, node.path, intent);

	return (
		<li>
			<TreeRow
				testid="file-node"
				kind={isDir ? "dir" : "file"}
				expanded={expanded}
				label={node.name}
				onClick={isDir ? () => setExpanded((value) => !value) : () => open("preview")}
				onDoubleClick={isDir ? undefined : () => open("keep")}
			/>
			{isDir && expanded && children && (
				<ul className="flex flex-col pl-md">
					{children.map((child) => (
						<FileNodeRow key={child.path} node={child} workspaceId={workspaceId} />
					))}
				</ul>
			)}
		</li>
	);
}
