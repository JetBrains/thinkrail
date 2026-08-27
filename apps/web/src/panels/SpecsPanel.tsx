import {
	RiBookOpenLine as BookOpen,
	RiBox3Line as Box,
	RiStackLine as Boxes,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileTextLine as FileText,
	RiListCheck3 as ListChecks,
	RiNetworkLine as Network,
	RiRefreshLine as RefreshCw,
	RiBookOpenFill,
	RiBox3Fill,
	RiFileTextFill,
	RiNetworkFill,
	RiStackFill,
} from "@remixicon/react";
import { useEffect, useMemo, useState } from "react";
import { SkeletonRows } from "../components/Skeleton";
import { IconTooltip } from "../components/ui/tooltip";
import { cn } from "../lib";
import { selectActiveEditorTab, useAppStore } from "../store";
import { openFileInTab } from "./openTabs";
import {
	buildSpecTree,
	type SpecTreeNode,
	specDisplayTitle,
	specRoleLabel,
	specRoleTag,
} from "./specTree";

export function SpecsPanel({
	workspaceId,
	failed = false,
	onRefresh,
}: {
	workspaceId: string;
	failed?: boolean;
	onRefresh?: () => void;
}) {
	const nodes = useAppStore((s) => s.specsByWorkspace[workspaceId]) ?? null;
	const activeTab = useAppStore((state) => selectActiveEditorTab(state, workspaceId));
	const specRequest = useAppStore((s) => s.specRequest);

	useEffect(() => {
		if (specRequest?.workspaceId !== workspaceId) return;
		if (useAppStore.getState().specRequest !== specRequest) return;
		void openFileInTab(workspaceId, specRequest.path, "preview", specRequest.navigation);
		useAppStore.getState().clearSpecRequest();
	}, [specRequest, workspaceId]);

	const roots = useMemo(() => (nodes ? buildSpecTree(nodes) : null), [nodes]);

	const content =
		failed && !nodes ? (
			<p data-testid="specs-error" className="px-4 py-4 tr-text-metadata text-text-muted">
				Couldn't load specs — Refresh to retry.
			</p>
		) : nodes === null || roots === null ? (
			<div className="px-4 py-4">
				<SkeletonRows rows={6} />
			</div>
		) : nodes.length === 0 ? (
			<p className="px-4 py-4 tr-text-metadata text-text-muted">No specs</p>
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
				<div className="flex h-panel-header-row shrink-0 items-center justify-end border-border-muted border-b px-12">
					<IconTooltip label="Refresh specs">
						<button
							type="button"
							data-testid="specs-refresh"
							aria-label="Refresh specs"
							onClick={onRefresh}
							className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							<RefreshCw className="size-14" />
						</button>
					</IconTooltip>
				</div>
			) : null}
			{content}
		</div>
	);
}

function specRoleIcon(type: string, filled: boolean) {
	switch (type) {
		case "goal-and-requirements":
			return filled ? RiBookOpenFill : BookOpen;
		case "architecture-design":
			return filled ? RiNetworkFill : Network;
		case "module-design":
			return filled ? RiBox3Fill : Box;
		case "submodule-design":
			return filled ? RiStackFill : Boxes;
		case "task-spec":
			return ListChecks;
		default:
			return filled ? RiFileTextFill : FileText;
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
	const DocumentIcon = specRoleIcon(node.type, isActive || isMainSpec);
	const Chevron = expanded ? ChevronDown : ChevronRight;

	return (
		<li>
			<div
				className={cn(
					"group flex h-28 min-w-0 items-stretch rounded-[var(--radius-sm)] px-4 transition-colors",
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
						className="flex w-20 shrink-0 items-center justify-center self-stretch rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
					>
						<Chevron className="size-16" />
					</button>
				) : (
					<span className="w-20 shrink-0" />
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
					className="flex h-28 min-w-0 flex-1 items-center gap-4 rounded-[var(--radius-sm)] text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
				>
					<DocumentIcon
						className={cn(
							"size-14 shrink-0 transition-colors",
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
						{specDisplayTitle(node.title)}
					</span>
					<span
						data-testid="spec-role"
						className={cn(
							"hidden shrink-0 text-right tr-text-eyebrow group-hover:block group-focus-within:block",
							isMainSpec || isActive ? "text-primary" : "text-text-subtle",
						)}
					>
						{trailingRole}
					</span>
				</button>
			</div>
			{children.length > 0 && expanded && (
				<ul className="flex flex-col pl-12">
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
