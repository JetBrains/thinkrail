import type { FileNode } from "@thinkrail/contracts";
import { ChevronDown, ChevronRight, File as FileIcon, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { openFileInTab } from "./openFile";

/**
 * Lazy file tree of the active worktree. Double-click a file to open it as a center editor tab.
 * Live: the store's per-workspace fs tick (the host's `workspace.fsChanged` nudge) silently refetches
 * the root and every expanded dir — expansion, keys, and scroll survive; a refetch failure keeps the
 * last good listing.
 */
export function FileTree({ workspaceId }: { workspaceId: string }) {
	const [nodes, setNodes] = useState<FileNode[] | null>(null);
	const fsTick = useAppStore((s) => s.fsChangesByWorkspace[workspaceId]?.tick ?? 0);

	// Hard reset only on workspace switch — a tick refresh keeps the old tree until the re-read lands.
	// biome-ignore lint/correctness/useExhaustiveDependencies: workspaceId is the trigger (reset-on-switch), not a body input
	useEffect(() => {
		setNodes(null);
	}, [workspaceId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: fsTick is the live-refresh trigger, not a body input
	useEffect(() => {
		let cancelled = false;
		getTransport()
			.request("fs.readDir", { workspaceId, path: "." })
			.then((result) => {
				if (!cancelled) setNodes(result);
			})
			.catch(() => {
				if (!cancelled) setNodes((prev) => prev ?? []);
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, fsTick]);

	if (nodes === null) return <p className="px-xs py-xs text-xs text-hint">Loading…</p>;
	if (nodes.length === 0) return <p className="px-xs py-xs text-xs text-hint">Empty</p>;
	return (
		<ul className="flex flex-col">
			{nodes.map((node) => (
				<FileNodeRow key={node.path} node={node} workspaceId={workspaceId} fsTick={fsTick} />
			))}
		</ul>
	);
}

function FileNodeRow({
	node,
	workspaceId,
	fsTick,
}: {
	node: FileNode;
	workspaceId: string;
	fsTick: number;
}) {
	const isDir = node.kind === "dir";
	const [expanded, setExpanded] = useState(false);
	const [children, setChildren] = useState<FileNode[] | null>(null);

	// An expanded dir (re-)fetches its listing on expansion AND on every fs tick, silently keeping the
	// previous children on failure (e.g. the dir vanished — the parent's own refetch drops this row).
	// biome-ignore lint/correctness/useExhaustiveDependencies: fsTick is the live-refresh trigger, not a body input
	useEffect(() => {
		if (!isDir || !expanded) return;
		let cancelled = false;
		getTransport()
			.request("fs.readDir", { workspaceId, path: node.path })
			.then((result) => {
				if (!cancelled) setChildren(result);
			})
			.catch(() => {
				if (!cancelled) setChildren((prev) => prev ?? []);
			});
		return () => {
			cancelled = true;
		};
	}, [isDir, expanded, workspaceId, node.path, fsTick]);

	const open = () => void openFileInTab(workspaceId, node.path);

	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<li>
			<button
				type="button"
				data-testid="file-node"
				data-kind={node.kind}
				onClick={isDir ? () => setExpanded((value) => !value) : undefined}
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
						<FileNodeRow key={child.path} node={child} workspaceId={workspaceId} fsTick={fsTick} />
					))}
				</ul>
			)}
		</li>
	);
}
