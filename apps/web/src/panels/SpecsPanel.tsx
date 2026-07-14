import type { SpecGraphNode } from "@thinkrail/contracts";
import {
	BookOpen,
	Box,
	Boxes,
	ChevronDown,
	ChevronRight,
	FileText,
	ListChecks,
	Network,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { openFileInTab } from "./openFile";
import { buildSpecTree, type SpecTreeNode, specRoleLabel, specRoleTag } from "./specTree";

/**
 * Read-only spec-graph viewer for the active worktree: one `spec.graph` fetch per mount (read-on-demand,
 * no push — the header Refresh button in `RightPanel` re-fetches by remounting via `key`), rendered as
 * a compact document-first `parent` tree. Fixed indentation carries depth without persistent connector
 * lines; the chevron expands children and one click on the document row opens its rendered spec.
 */
export function SpecsPanel({ workspaceId }: { workspaceId: string }) {
	const [nodes, setNodes] = useState<SpecGraphNode[] | null>(null);
	const [failed, setFailed] = useState(false);
	const activeTabId = useAppStore((state) => state.activeTabByWorkspace[workspaceId] ?? null);

	useEffect(() => {
		let cancelled = false;
		setNodes(null);
		setFailed(false);
		getTransport()
			.request("spec.graph", { workspaceId })
			.then((result) => {
				if (!cancelled) setNodes(result.nodes);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	const roots = useMemo(() => (nodes ? buildSpecTree(nodes) : null), [nodes]);

	if (failed)
		return (
			<p data-testid="specs-error" className="px-xs py-xs text-xs text-hint">
				Couldn't load specs — Refresh to retry.
			</p>
		);
	if (nodes === null || roots === null)
		return <p className="px-xs py-xs text-xs text-hint">Loading…</p>;
	if (nodes.length === 0) return <p className="px-xs py-xs text-xs text-hint">No specs</p>;
	return (
		<ul className="flex flex-col">
			{roots.map((root) => (
				<SpecNodeRow
					key={root.node.id}
					tree={root}
					workspaceId={workspaceId}
					activeTabId={activeTabId}
					depth={0}
				/>
			))}
		</ul>
	);
}

function specRoleIcon(type: string) {
	switch (type) {
		case "goal-and-requirements":
			return BookOpen;
		case "architecture-design":
			return Network;
		case "module-design":
			return Box;
		case "submodule-design":
			return Boxes;
		case "task-spec":
			return ListChecks;
		default:
			return FileText;
	}
}

function SpecNodeRow({
	tree,
	workspaceId,
	activeTabId,
	depth,
}: {
	tree: SpecTreeNode;
	workspaceId: string;
	activeTabId: string | null;
	depth: number;
}) {
	const { node, children } = tree;
	const [expanded, setExpanded] = useState(true);
	const tabId = `${workspaceId}:${node.path}`;
	const isActive = activeTabId === tabId;
	const isMainSpec = depth === 0 && node.type === "goal-and-requirements";
	const role = specRoleLabel(node.type);
	const trailingRole = isMainSpec ? "Main spec" : specRoleTag(node.type);
	const DocumentIcon = specRoleIcon(node.type);
	const Chevron = expanded ? ChevronDown : ChevronRight;

	return (
		<li>
			<div
				className={cn(
					"group flex h-7 min-w-0 items-stretch rounded-[var(--radius-sm)] transition-colors",
					isActive
						? "bg-[var(--primary-10)] ring-1 ring-[var(--primary-40)] ring-inset"
						: "hover:bg-hover",
				)}
			>
				{children.length > 0 ? (
					<button
						type="button"
						data-testid="spec-toggle"
						aria-label={expanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
						aria-expanded={expanded}
						onClick={() => setExpanded((value) => !value)}
						className="flex w-5 shrink-0 items-center justify-center self-stretch rounded-[var(--radius-sm)] text-hint outline-none transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
					>
						<Chevron className="size-3.5" />
					</button>
				) : (
					<span className="w-5 shrink-0" />
				)}
				<button
					type="button"
					data-testid="spec-node"
					data-spec-id={node.id}
					data-spec-type={node.type}
					data-spec-role={trailingRole}
					data-main-spec={isMainSpec ? "true" : undefined}
					data-active={isActive}
					data-depth={depth}
					aria-current={isActive ? "page" : undefined}
					aria-label={`Open ${node.title}. ${isMainSpec ? "Main spec" : role}`}
					title={`${node.title}\n${node.id} · ${node.type}`}
					onClick={() => void openFileInTab(workspaceId, node.path)}
					className="flex h-7 min-w-0 flex-1 items-center gap-xs rounded-[var(--radius-sm)] pr-xs text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
				>
					<DocumentIcon
						className={cn(
							"size-3.5 shrink-0 transition-colors",
							isMainSpec || isActive ? "text-primary" : "text-hint group-hover:text-muted",
						)}
					/>
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-sm transition-colors",
							isActive ? "font-medium text-text" : "text-muted group-hover:text-text",
						)}
					>
						{node.title}
					</span>
					<span
						data-testid="spec-role"
						className={cn(
							"max-w-16 shrink-0 truncate text-right text-[9px] uppercase tracking-wider",
							isMainSpec || isActive ? "font-medium text-primary" : "text-hint",
						)}
					>
						{trailingRole}
					</span>
				</button>
			</div>
			{children.length > 0 && expanded && (
				<ul className="flex flex-col pl-md">
					{children.map((child) => (
						<SpecNodeRow
							key={child.node.id}
							tree={child}
							workspaceId={workspaceId}
							activeTabId={activeTabId}
							depth={depth + 1}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
