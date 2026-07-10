import type { FileNode } from "@thinkrail/contracts";
import { ChevronDown, ChevronRight, File as FileIcon, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { getTransport } from "../transport";
import { openFileInTab } from "./openFile";

/** Lazy file tree of the active worktree. Double-click a file to open it as a center editor tab. */
export function FileTree({ workspaceId }: { workspaceId: string }) {
	const [nodes, setNodes] = useState<FileNode[] | null>(null);

	useEffect(() => {
		let cancelled = false;
		setNodes(null);
		getTransport()
			.request("fs.readDir", { workspaceId, path: "." })
			.then((result) => {
				if (!cancelled) setNodes(result);
			})
			.catch(() => {
				if (!cancelled) setNodes([]);
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	if (nodes === null) return <p className="px-xs py-xs text-xs text-hint">Loading…</p>;
	if (nodes.length === 0) return <p className="px-xs py-xs text-xs text-hint">Empty</p>;
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

	const toggle = async () => {
		if (!isDir) return;
		const next = !expanded;
		setExpanded(next);
		if (next && children === null) {
			try {
				setChildren(await getTransport().request("fs.readDir", { workspaceId, path: node.path }));
			} catch {
				setChildren([]);
			}
		}
	};

	const open = () => void openFileInTab(workspaceId, node.path);

	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<li>
			<button
				type="button"
				data-testid="file-node"
				data-kind={node.kind}
				onClick={toggle}
				onDoubleClick={isDir ? undefined : open}
				className="flex h-6 w-full items-center gap-xs rounded-[var(--radius-sm)] px-xs text-left text-sm text-muted hover:bg-hover"
			>
				{isDir ? (
					<Chevron className="size-3.5 shrink-0 text-hint" />
				) : (
					<span className="size-3.5 shrink-0" />
				)}
				{isDir ? (
					<Folder className="size-4 shrink-0 text-hint" />
				) : (
					<FileIcon className="size-4 shrink-0 text-hint" />
				)}
				<span className="truncate">{node.name}</span>
			</button>
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
