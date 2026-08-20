import {
	BookOpen,
	Box,
	Boxes,
	ChevronDown,
	ChevronRight,
	FileText,
	ListChecks,
	Network,
	RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib";
import { selectActiveEditorTab, useAppStore } from "../store";
import { openFileInTab } from "./openTabs";
import { buildSpecTree, type SpecTreeNode, specRoleLabel, specRoleTag } from "./specTree";

/**
 * Read-only spec-graph viewer for the active worktree, rendered as a compact document-first `parent`
 * tree — a pure reader of the store snapshot that `useWorkspaceSpecs` (owned by
 * `WorkspaceWorkbench`, so it outlives this tab) keeps current. Rows are keyed by spec id, so expansion state survives a silent
 * refresh; a failed re-read keeps the last good tree and `failed` renders the hint only when there is
 * nothing to show. The chevron expands children; one click on the document row **previews** its rendered
 * spec in the workspace's reusable center tab (so reading down the graph never piles tabs up) and a
 * double click keeps it.
 *
 * Being keyed per workspace, a switch shows that workspace's last known tree while the re-read is in
 * flight — there is nothing to reset. A `specRequest` deep link (the divider's "N specs" chip) opens the
 * rendered spec and is **consumed**: it opens a center tab, so replaying it on a remount or a refetch would
 * yank the user's tab back. The row lights up from the active file's semantic path, independent of its
 * stable shared placement id.
 */
export function SpecsPanel({
	workspaceId,
	failed = false,
	onRefresh,
}: {
	workspaceId: string;
	/** The current workspace's spec read failed (from `useWorkspaceSpecs`, which owns the fetch). */
	failed?: boolean;
	onRefresh?: () => void;
}) {
	const nodes = useAppStore((s) => s.specsByWorkspace[workspaceId]) ?? null;
	const activeTab = useAppStore((state) => selectActiveEditorTab(state, workspaceId));
	const specRequest = useAppStore((s) => s.specRequest);

	// A chat deep-link targeting this workspace: open the requested spec as a rendered doc tab, then clear
	// the request. The path arrives as pi reported it (possibly absolute) — `openFileInTab` canonicalizes it
	// to the worktree-relative tab identity, so no graph lookup is needed here (and a spec created seconds
	// ago, not yet in the snapshot, opens just the same).
	useEffect(() => {
		if (specRequest?.workspaceId !== workspaceId) return;
		if (useAppStore.getState().specRequest !== specRequest) return;
		void openFileInTab(workspaceId, specRequest.path, "preview", specRequest.navigation);
		useAppStore.getState().clearSpecRequest();
	}, [specRequest, workspaceId]);

	const roots = useMemo(() => (nodes ? buildSpecTree(nodes) : null), [nodes]);

	const content =
		failed && !nodes ? (
			<p data-testid="specs-error" className="px-xs py-xs tr-text-metadata text-text-muted">
				Couldn't load specs — Refresh to retry.
			</p>
		) : nodes === null || roots === null ? (
			<p className="px-xs py-xs tr-text-metadata text-text-muted">Loading…</p>
		) : nodes.length === 0 ? (
			<p className="px-xs py-xs tr-text-metadata text-text-muted">No specs</p>
		) : (
			<ul className="flex flex-col">
				{roots.map((root) => (
					<SpecNodeRow
						key={root.node.id}
						tree={root}
						workspaceId={workspaceId}
						activeFilePath={activeTab?.kind === "file" ? activeTab.path : null}
						depth={0}
					/>
				))}
			</ul>
		);
	return (
		<div className="flex min-h-0 flex-col">
			{onRefresh ? (
				<div className="flex h-7 shrink-0 items-center justify-end border-border-muted border-b px-xs">
					<button
						type="button"
						data-testid="specs-refresh"
						aria-label="Refresh specs"
						title="Refresh specs"
						onClick={onRefresh}
						className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					>
						<RefreshCw className="size-3.5" />
					</button>
				</div>
			) : null}
			{content}
		</div>
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
	activeFilePath,
	depth,
}: {
	tree: SpecTreeNode;
	workspaceId: string;
	activeFilePath: string | null;
	depth: number;
}) {
	const { node, children } = tree;
	const [expanded, setExpanded] = useState(true);
	const isActive = activeFilePath === node.path;
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
						? "bg-primary-subtle ring-1 ring-primary-muted ring-inset"
						: "hover:bg-control-bg-hovered",
				)}
			>
				{children.length > 0 ? (
					<button
						type="button"
						data-testid="spec-toggle"
						aria-label={expanded ? `Collapse ${node.title}` : `Expand ${node.title}`}
						aria-expanded={expanded}
						onClick={() => setExpanded((value) => !value)}
						className="flex w-5 shrink-0 items-center justify-center self-stretch rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
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
					onClick={() => void openFileInTab(workspaceId, node.path, "preview")}
					onDoubleClick={() => void openFileInTab(workspaceId, node.path, "keep")}
					className="flex h-7 min-w-0 flex-1 items-center gap-xs rounded-[var(--radius-sm)] pr-xs text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
				>
					<DocumentIcon
						className={cn(
							"size-3.5 shrink-0 transition-colors",
							isMainSpec || isActive
								? "text-primary"
								: "text-text-muted group-hover:text-text-muted",
						)}
					/>
					<span
						className={cn(
							"min-w-0 flex-1 truncate tr-text-ui transition-colors",
							isActive ? "text-text-default" : "text-text-muted group-hover:text-text-default",
						)}
					>
						{node.title}
					</span>
					<span
						data-testid="spec-role"
						className={cn(
							"max-w-16 shrink-0 truncate text-right tr-text-eyebrow",
							isMainSpec || isActive ? "text-primary" : "text-text-subtle",
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
							activeFilePath={activeFilePath}
							depth={depth + 1}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
