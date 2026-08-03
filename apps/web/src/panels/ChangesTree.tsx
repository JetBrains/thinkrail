import type { GitFileChange } from "@thinkrail/contracts";
import { useState } from "react";
import type { TabIntent } from "../store";
import { ChangeRowActions, ROW_MENU_SLOT } from "./ChangeRowActions";
import { buildChangesTree, type ChangeTreeNode, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { TreeRow } from "./TreeRow";

/**
 * The Changes panel's folder view: the changed files laid out as a tree, styled exactly like the All-files
 * tree (shared `TreeRow`) with a per-file / per-folder `+/−` badge (shared `DiffStatBadge`) mirroring the
 * project rail's worktree stats. **File** rows carry the same action menu the flat list does
 * (`ChangeRowActions` — hover `⌄` + right-click); folder rows get none, since nothing in that menu applies to
 * a folder. Presentational — the flat list and this view share the same `onOpen` (open/focus the file's diff
 * tab, at the gesture's `TabIntent`) and `isActive` (selected row) from `ChangesPanel`.
 */
export function ChangesTree({
	changes,
	onOpen,
	isActive,
}: {
	changes: readonly GitFileChange[];
	onOpen: (path: string, intent: TabIntent) => void;
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
	onOpen: (path: string, intent: TabIntent) => void;
	isActive: (path: string) => boolean;
}) {
	// Folders default open — change sets are small, so the tree reads at a glance (like VS Code's SCM tree).
	const [expanded, setExpanded] = useState(true);

	if (node.kind === "file") {
		return (
			<li>
				<ChangeRowActions
					path={node.path}
					active={isActive(node.path)}
					onView={() => onOpen(node.path, "preview")}
				>
					{({ onContextMenu }) => (
						<TreeRow
							testid="change-node"
							onContextMenu={onContextMenu}
							kind="file"
							// The wrapper paints the band (it has to cover the trailing ⌄ slot); this row paints none.
							highlight="wrapper"
							active={isActive(node.path)}
							dataStatus={node.status}
							label={node.name}
							labelClassName={statusNameClass(node.status)}
							onClick={() => onOpen(node.path, "preview")}
							onDoubleClick={() => onOpen(node.path, "keep")}
							trailing={<DiffStatBadge added={node.added} removed={node.removed} />}
						/>
					)}
				</ChangeRowActions>
			</li>
		);
	}

	return (
		<li>
			{/* A folder has no row menu, but it reserves the same trailing slot the file rows spend on their `⌄`
			    — otherwise the `+N −M` column would sit further right on folders than on files. */}
			<div className="flex min-w-0 items-center">
				<TreeRow
					testid="change-tree-folder"
					kind="dir"
					expanded={expanded}
					label={node.name}
					onClick={() => setExpanded((v) => !v)}
					trailing={<DiffStatBadge added={node.added} removed={node.removed} />}
				/>
				<span className={ROW_MENU_SLOT} />
			</div>
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
