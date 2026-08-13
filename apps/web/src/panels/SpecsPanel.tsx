import type { SpecTypeInfo } from "@thinkrail/contracts";
import {
	BookOpen,
	Box,
	Boxes,
	ChevronDown,
	ChevronRight,
	FileText,
	ListChecks,
	Network,
	Plus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib";
import { useAppStore } from "../store";
import { openFileInTab } from "./openTabs";
import { SpecTypeDialog } from "./SpecTypeDialog";
import { buildSpecTree, type SpecTreeNode, specRoleLabel, specRoleTag } from "./specTree";

/**
 * Read-only spec-graph viewer for the active worktree, rendered as a compact document-first `parent`
 * tree — a pure reader of the store snapshot that `useWorkspaceSpecs` (owned by `RightPanel`, so it
 * outlives this tab) keeps current. Rows are keyed by spec id, so expansion state survives a silent
 * refresh; a failed re-read keeps the last good tree and `failed` renders the hint only when there is
 * nothing to show. The chevron expands children; one click on the document row **previews** its rendered
 * spec in the workspace's reusable center tab (so reading down the graph never piles tabs up) and a
 * double click keeps it.
 *
 * Being keyed per workspace, a switch shows that workspace's last known tree while the re-read is in
 * flight — there is nothing to reset. A `specRequest` deep link (the divider's "N specs" chip) opens the
 * rendered spec and is **consumed**: it opens a center tab, so replaying it on a remount or a refetch would
 * yank the user's tab back. The row lights up on its own, since rows key off the active tab id.
 */
export function SpecsPanel({
	workspaceId,
	failed = false,
}: {
	workspaceId: string;
	/** The current workspace's spec read failed (from `useWorkspaceSpecs`, which owns the fetch). */
	failed?: boolean;
}) {
	const nodes = useAppStore((s) => s.specsByWorkspace[workspaceId]) ?? null;
	const types = useAppStore((s) => s.specTypesByWorkspace[workspaceId]) ?? null;
	const activeTabId = useAppStore((state) => state.activeTabByWorkspace[workspaceId] ?? null);
	const specRequest = useAppStore((s) => s.specRequest);
	const [typeDialogOpen, setTypeDialogOpen] = useState(false);

	// A chat deep-link targeting this workspace: open the requested spec as a rendered doc tab, then clear
	// the request. The path arrives as pi reported it (possibly absolute) — `openFileInTab` canonicalizes it
	// to the worktree-relative tab identity, so no graph lookup is needed here (and a spec created seconds
	// ago, not yet in the snapshot, opens just the same).
	useEffect(() => {
		if (specRequest?.workspaceId !== workspaceId) return;
		void openFileInTab(workspaceId, specRequest.path, "preview");
		useAppStore.getState().clearSpecRequest();
	}, [specRequest, workspaceId]);

	const roots = useMemo(() => (nodes ? buildSpecTree(nodes) : null), [nodes]);
	const typeByName = useMemo(() => new Map((types ?? []).map((t) => [t.name, t])), [types]);

	if (failed && !nodes)
		return (
			<p data-testid="specs-error" className="px-xs py-xs tr-text-metadata text-text-muted">
				Couldn't load specs — Refresh to retry.
			</p>
		);
	if (nodes === null || roots === null)
		return <p className="px-xs py-xs tr-text-metadata text-text-muted">Loading…</p>;
	return (
		<div className="flex flex-col gap-xs">
			{nodes.length === 0 ? (
				<p className="px-xs py-xs tr-text-metadata text-text-muted">No specs</p>
			) : (
				<ul className="flex flex-col">
					{roots.map((root) => (
						<SpecNodeRow
							key={root.node.id}
							tree={root}
							workspaceId={workspaceId}
							activeTabId={activeTabId}
							typeByName={typeByName}
							depth={0}
						/>
					))}
				</ul>
			)}
			{types !== null && (
				<SpecTypesLegend types={types} onNewType={() => setTypeDialogOpen(true)} />
			)}
			<SpecTypeDialog
				open={typeDialogOpen}
				workspaceId={workspaceId}
				existing={types ?? []}
				onOpenChange={setTypeDialogOpen}
			/>
		</div>
	);
}

/**
 * The registry legend: the registered type cards (title, lifecycle, origin) plus the "New type" entry
 * into the type constructor. Sourced from the same `spec.graph` snapshot as the tree, so a card the
 * agent (or the constructor) just wrote appears on the next refetch.
 */
function SpecTypesLegend({ types, onNewType }: { types: SpecTypeInfo[]; onNewType: () => void }) {
	const [expanded, setExpanded] = useState(false);
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<div
			data-testid="spec-types-legend"
			className="flex flex-col border-border-default border-t pt-xs"
		>
			<div className="flex h-7 items-center">
				<button
					type="button"
					data-testid="spec-types-toggle"
					aria-expanded={expanded}
					onClick={() => setExpanded((v) => !v)}
					className="flex min-w-0 flex-1 items-center gap-xs rounded-[var(--radius-sm)] px-xs text-left text-text-muted tr-text-eyebrow outline-none transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
				>
					<Chevron className="size-3.5 shrink-0" />
					Spec types ({types.length})
				</button>
				<button
					type="button"
					data-testid="spec-type-new"
					aria-label="New spec type"
					title="New spec type — define what a kind of spec is for and what it should contain"
					onClick={onNewType}
					className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
				>
					<Plus className="size-3.5" />
				</button>
			</div>
			{expanded && (
				<ul className="flex flex-col">
					{types.map((t) => (
						<li
							key={t.name}
							data-testid="spec-type-row"
							data-type-name={t.name}
							data-type-origin={t.origin}
							className="flex h-6 items-center gap-xs px-xs"
							title={t.description}
						>
							<span className="min-w-0 flex-1 truncate tr-text-metadata text-text-muted">
								{t.title}
							</span>
							<span className="shrink-0 tr-text-eyebrow text-text-subtle">
								{t.lifecycle === "ephemeral"
									? "ephemeral"
									: t.origin === "project"
										? "project"
										: null}
							</span>
						</li>
					))}
				</ul>
			)}
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
	activeTabId,
	typeByName,
	depth,
}: {
	tree: SpecTreeNode;
	workspaceId: string;
	activeTabId: string | null;
	/** The snapshot's registered type cards, by name — titles, descriptions, and the lifecycle dim. */
	typeByName: Map<string, SpecTypeInfo>;
	depth: number;
}) {
	const { node, children } = tree;
	const [expanded, setExpanded] = useState(true);
	const tabId = `${workspaceId}:${node.path}`;
	const isActive = activeTabId === tabId;
	const isMainSpec = depth === 0 && node.type === "goal-and-requirements";
	const typeInfo = typeByName.get(node.type);
	const isEphemeral = typeInfo?.lifecycle === "ephemeral";
	const role = typeInfo?.title ?? specRoleLabel(node.type);
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
					data-spec-lifecycle={isEphemeral ? "ephemeral" : "durable"}
					data-main-spec={isMainSpec ? "true" : undefined}
					data-active={isActive}
					data-depth={depth}
					aria-current={isActive ? "page" : undefined}
					aria-label={`Open ${node.title}. ${isMainSpec ? "Main spec" : role}`}
					title={`${node.title}\n${node.id} · ${node.type}${typeInfo ? `\n${typeInfo.description}` : ""}${isEphemeral ? "\n(ephemeral — serves one piece of work, not ground truth)" : ""}`}
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
							isEphemeral && "italic text-text-subtle",
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
							activeTabId={activeTabId}
							typeByName={typeByName}
							depth={depth + 1}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
