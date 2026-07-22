import type { GitFileChange } from "@thinkrail/contracts";
import { useState } from "react";
import { buildChangesTree, type ChangeTreeNode, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { TreeRow } from "./TreeRow";

/**
 * The Changes panel's folder view: the changed files laid out as a tree, styled exactly like the All-files
 * tree (shared `TreeRow`) with a per-file / per-folder `+/−` badge (shared `DiffStatBadge`) mirroring the
 * project rail's worktree stats. Presentational — the flat list and this view share the same `onOpen`
 * (open/focus the file's diff tab) and `isActive` (selected row) from `ChangesPanel`.
 */
export function ChangesTree({
	changes,
	onOpen,
	isActive,
}: {
	changes: readonly GitFileChange[];
	onOpen: (path: string) => void;
	isActive: (path: string) => boolean;
}) {
	return (
		<ul className="flex flex-col">
			{buildChangesTree(changes).map((node) => (
				<ChangeNodeRow key={node.path} node={node} onOpen={onOpen} isActive={isActive} />
			))}
		</ul>
	);
}

function ChangeNodeRow({
	node,
	onOpen,
	isActive,
}: {
	node: ChangeTreeNode;
	onOpen: (path: string) => void;
	isActive: (path: string) => boolean;
}) {
	// Folders default open — change sets are small, so the tree reads at a glance (like VS Code's SCM tree).
	const [expanded, setExpanded] = useState(true);

	if (node.kind === "file") {
		return (
			<li>
				<TreeRow
					testid="change-node"
					kind="file"
					active={isActive(node.path)}
					dataStatus={node.status}
					label={node.name}
					labelClassName={statusNameClass(node.status)}
					onClick={() => onOpen(node.path)}
					trailing={<DiffStatBadge added={node.added} removed={node.removed} />}
				/>
			</li>
		);
	}

	return (
		<li>
			<TreeRow
				testid="change-tree-folder"
				kind="dir"
				expanded={expanded}
				label={node.name}
				onClick={() => setExpanded((v) => !v)}
				trailing={<DiffStatBadge added={node.added} removed={node.removed} />}
			/>
			{expanded && (
				<ul className="flex flex-col pl-md">
					{node.children.map((child) => (
						<ChangeNodeRow key={child.path} node={child} onOpen={onOpen} isActive={isActive} />
					))}
				</ul>
			)}
		</li>
	);
}
