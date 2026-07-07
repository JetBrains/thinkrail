import type { SpecGraphNode } from "@thinkrail/contracts";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { buildSpecTree, type SpecTreeNode } from "./specTree";

/**
 * Read-only spec-graph viewer for the active worktree: one `spec.graph` fetch per mount (read-on-demand,
 * no push — the header Refresh button in `RightPanel` re-fetches by remounting via `key`), rendered as
 * the `parent` tree — roots are nodes with no (or a dangling) parent — default-expanded. A fetch failure
 * renders a distinct error hint (never the "No specs" empty state). Double-click a node to open its spec
 * file as a center editor tab, like the file tree.
 */
export function SpecsPanel({ workspaceId }: { workspaceId: string }) {
	const [nodes, setNodes] = useState<SpecGraphNode[] | null>(null);
	const [failed, setFailed] = useState(false);

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
				<SpecNodeRow key={root.node.id} tree={root} workspaceId={workspaceId} depth={0} />
			))}
		</ul>
	);
}

function SpecNodeRow({
	tree,
	workspaceId,
	depth,
}: {
	tree: SpecTreeNode;
	workspaceId: string;
	depth: number;
}) {
	const { node, children } = tree;
	const [expanded, setExpanded] = useState(true);

	const open = async () => {
		const id = `${workspaceId}:${node.path}`;
		const store = useAppStore.getState();
		if ((store.tabsByWorkspace[workspaceId] ?? []).some((t) => t.id === id)) {
			store.setActiveTab(id);
			return;
		}
		try {
			const { content } = await getTransport().request("fs.readFile", {
				workspaceId,
				path: node.path,
			});
			const name = node.path.split("/").pop() ?? node.path;
			useAppStore
				.getState()
				.openTab({ kind: "file", id, workspaceId, path: node.path, name, content });
		} catch {
			// a read failure leaves the tree unchanged
		}
	};

	// Spec nodes are container AND file at once, so the gestures are disjoint: the chevron alone
	// toggles, double-click on the row opens, and row single-click stays unclaimed (reserved for the
	// future selected-node detail strip). Row anatomy mirrors FileTree; the chevron affordance is the
	// ProjectTree one (brightens via text color on hover — no background square).
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<li>
			<div className="group flex h-6 items-center gap-xs rounded-[var(--radius-sm)] px-xs transition-colors hover:bg-hover">
				{children.length > 0 ? (
					<button
						type="button"
						data-testid="spec-toggle"
						aria-label={expanded ? "Collapse" : "Expand"}
						aria-expanded={expanded}
						onClick={() => setExpanded(!expanded)}
						className="flex size-3.5 shrink-0 items-center justify-center text-hint transition-colors hover:text-text"
					>
						<Chevron className="size-3.5" />
					</button>
				) : (
					<span className="size-3.5 shrink-0" />
				)}
				<button
					type="button"
					data-testid="spec-node"
					data-spec-id={node.id}
					data-depth={depth}
					title={`${node.id} · ${node.type}`}
					onDoubleClick={open}
					className="flex h-6 min-w-0 flex-1 items-center gap-xs text-left text-sm text-muted"
				>
					<FileText className="size-4 shrink-0 text-hint" />
					<span className="truncate">{node.title}</span>
					{node.status && (
						<span className="ml-auto shrink-0 text-[10px] text-hint">{node.status}</span>
					)}
				</button>
			</div>
			{children.length > 0 && expanded && (
				<ul className="flex flex-col pl-md">
					{children.map((child) => (
						<SpecNodeRow
							key={child.node.id}
							tree={child}
							workspaceId={workspaceId}
							depth={depth + 1}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
